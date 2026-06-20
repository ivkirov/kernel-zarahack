"""Vectorized time-poverty simulation core, shared by training and the API.

Uses the learned travel-time model (traveltime.pkl) to convert distances to
minutes, then computes the annual-hours-saved ROI of placing a new facility.
"""

from pathlib import Path

import joblib
import numpy as np

from geo import haversine_km

MODELS = Path(__file__).parent / "models"

VISITS = {"children_0_6": 180, "seniors_65p": 24}        # round trips / year
GROUP_SERVICES = {
    "children_0_6": ["kindergarten", "school"],
    "seniors_65p":  ["hospital", "clinic", "pharmacy"],
}
AMENITY_GROUP = {
    "kindergarten": "children_0_6", "school": "children_0_6",
    "hospital": "seniors_65p", "clinic": "seniors_65p", "pharmacy": "seniors_65p",
}

_TT = None


def travel_model():
    global _TT
    if _TT is None:
        _TT = joblib.load(MODELS / "traveltime.pkl")
    return _TT


def _haversine_vec(lat, lon, lats, lons):
    """Distance (km) from one point to arrays of points."""
    r = 6371.0088
    dlat = np.radians(lats - lat)
    dlon = np.radians(lons - lon)
    a = (np.sin(dlat / 2) ** 2
         + np.cos(np.radians(lat)) * np.cos(np.radians(lats)) * np.sin(dlon / 2) ** 2)
    return r * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))


def predict_minutes_vec(km_arr, is_urban_arr, dens_arr):
    X = np.column_stack([km_arr, is_urban_arr, dens_arr])
    pred = travel_model().predict(X)
    return np.clip(pred, 0.0, None)        # travel time can never be negative


def cell_features(cells, nodes, district_pts):
    """Per-cell is_urban (<=15km of a district centre) and dest_density (#nodes<=5km)."""
    node_lat, node_lon = nodes["lat"].values, nodes["lon"].values
    d_lat, d_lon = district_pts[:, 0], district_pts[:, 1]
    is_urban = np.array([
        int(np.any(_haversine_vec(la, lo, d_lat, d_lon) < 15))
        for la, lo in zip(cells["lat"].values, cells["lon"].values)])
    dens = np.array([
        int(np.sum(_haversine_vec(la, lo, node_lat, node_lon) < 5))
        for la, lo in zip(cells["lat"].values, cells["lon"].values)])
    return is_urban, dens


def baseline_minutes(cells, serving, is_urban, dens):
    """One-way minutes from each cell to its nearest existing serving node."""
    s_lat, s_lon = serving["lat"].values, serving["lon"].values
    nearest_km = np.array([
        _haversine_vec(la, lo, s_lat, s_lon).min() if len(serving) else 999.0
        for la, lo in zip(cells["lat"].values, cells["lon"].values)])
    return predict_minutes_vec(nearest_km, is_urban, dens), nearest_km


def annual_hours(minutes, pop, group):
    return minutes * 2 * VISITS[group] * pop / 60.0


def predict_hours(payload, X):
    """Predict annual-hours-saved from a placement payload, handling the
    log-target transform (if any) and the non-negativity clamp in one place."""
    p = payload["model"].predict(np.asarray(X, dtype=float))
    if payload.get("log_target"):
        p = np.expm1(p)
    return np.clip(p, 0.0, None)


# --------------------------------------------------------------------------- #
# Placement feature engineering — shared by training, serving and diagnostics.
# Location-FREE (no raw lat/lon) and BASELINE-AWARE: the strongest predictor of
# savings is the current "addressable time poverty" around a candidate.
# --------------------------------------------------------------------------- #
PLACEMENT_FEATURES = [
    "demand_5km", "demand_15km", "dist_nearest_service_km",
    "addressable_hours_10km", "addressable_hours_25km", "mean_baseline_min_15km",
]


def prepare_group(cells_all, nodes, group):
    """Slice to a demand group and attach per-cell baseline travel time + the
    annual wasted hours each cell currently suffers. Returns (cells, serving, is_urban)."""
    cells = cells_all[cells_all["group_key"] == group].reset_index(drop=True).copy()
    serving = nodes[nodes["service_type"].isin(GROUP_SERVICES[group])].reset_index(drop=True)
    district_pts = cells[["lat", "lon"]].drop_duplicates().values
    is_urban, dens = cell_features(cells, nodes, district_pts)
    base_min, _ = baseline_minutes(cells, serving, is_urban, dens)
    cells["base_min"] = base_min
    cells["base_hours"] = annual_hours(base_min, cells["population"].values, group)
    return cells, serving, is_urban


def candidate_features(lat, lon, cells, nodes):
    """Build the location-free, baseline-aware feature vector for one candidate.
    `cells` must carry the `base_min`/`base_hours` columns from prepare_group()."""
    c_lat, c_lon = cells["lat"].values, cells["lon"].values
    pop = cells["population"].values
    base_hours = cells["base_hours"].values
    base_min = cells["base_min"].values
    d = _haversine_vec(lat, lon, c_lat, c_lon)

    demand_5 = pop[d < 5].sum()
    demand_15 = pop[d < 15].sum()
    dist_near = (_haversine_vec(lat, lon, nodes["lat"].values, nodes["lon"].values).min()
                 if len(nodes) else 99.0)
    addr_10 = base_hours[d < 10].sum()          # wasted hours reachable within 10 km
    addr_25 = base_hours[d < 25].sum()
    near = d < 15
    mean_base = (np.average(base_min[near], weights=pop[near])
                 if near.any() and pop[near].sum() > 0 else 0.0)
    return [demand_5, demand_15, dist_near, addr_10, addr_25, mean_base]


def hours_saved(cand_lat, cand_lon, cells, base_min, is_urban, group, cand_dens):
    """Total annual hours saved if a serving facility is built at the candidate."""
    km_new = _haversine_vec(cand_lat, cand_lon, cells["lat"].values, cells["lon"].values)
    dens_arr = np.full(len(cells), cand_dens)
    min_new = predict_minutes_vec(km_new, is_urban, dens_arr)
    after = np.minimum(base_min, min_new)
    pop = cells["population"].values
    saved = annual_hours(base_min, pop, group) - annual_hours(after, pop, group)
    return float(saved.sum())
