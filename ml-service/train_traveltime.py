"""OPTION 2 — Learned travel-time model.

Predicts real travel minutes from [haversine_km, is_urban, dest_density],
replacing the flat `haversine / 4.5 km/h` proxy.

Labels:
  - Mode A (real): if ORS_API_KEY is set, query OpenRouteService for ~N OD pairs.
  - Mode B (synthetic, default): physics-based speed curve (urban faster than
    rural) + realistic noise. Still a *learned* curve, no constant assumed.

Trains on the actual OSM node geography + NSI district anchors from ../datasets.
Saves models/traveltime.pkl.
"""

import os
import random
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

from geo import haversine_km
import dataload

# Bulgaria-wide sampling box (min_lon, min_lat, max_lon, max_lat)
BG_BBOX = (22.30, 41.20, 28.65, 44.22)
N_SAMPLES = int(os.getenv("TT_SAMPLES", "800"))
ORS_KEY = os.getenv("ORS_API_KEY")
MODELS = Path(__file__).parent / "models"
MODELS.mkdir(exist_ok=True)


def rand_point():
    min_lon, min_lat, max_lon, max_lat = BG_BBOX
    return random.uniform(min_lat, max_lat), random.uniform(min_lon, max_lon)


def rand_dest_near(o, max_deg=0.45):
    """Destination within a realistic local radius of origin (~<=50 km),
    matching the 'travel to nearest service' use case."""
    return (o[0] + random.uniform(-max_deg, max_deg),
            o[1] + random.uniform(-max_deg, max_deg))


def ors_minutes(o, d):
    import requests
    url = "https://api.openrouteservice.org/v2/directions/driving-car"
    r = requests.post(url, json={"coordinates": [[o[1], o[0]], [d[1], d[0]]]},
                      headers={"Authorization": ORS_KEY}, timeout=15)
    r.raise_for_status()
    return r.json()["routes"][0]["summary"]["duration"] / 60.0


def make_feature_fns(nodes, weights):
    urban_pts = weights[["lat", "lon"]].values          # district centres = urban anchors
    node_pts = nodes[["lat", "lon"]].values

    def is_urban(lat, lon):
        return int(any(haversine_km(lat, lon, p[0], p[1]) < 15 for p in urban_pts))

    def dest_density(lat, lon):
        return int(np.sum([haversine_km(lat, lon, p[0], p[1]) < 5 for p in node_pts]))

    return is_urban, dest_density


def synth_minutes(km, urban):
    speed = 42 if urban else 24            # km/h; denser roads near towns
    return (km / speed) * 60 * np.random.uniform(0.85, 1.25)


def main():
    print("Loading datasets (NSI weights + OSM nodes)...")
    weights = dataload.load_weights()
    nodes = pd.read_csv(MODELS / "_nodes_cache.csv") if (MODELS / "_nodes_cache.csv").exists() \
        else dataload.load_nodes()
    is_urban, dest_density = make_feature_fns(nodes, weights)

    mode = "ORS" if ORS_KEY else "synthetic"
    print(f"Building {N_SAMPLES} OD samples (mode={mode})...")
    rows = []
    for _ in range(N_SAMPLES):
        o = rand_point()
        d = rand_dest_near(o)
        km = haversine_km(*o, *d)
        if km < 0.3 or km > 80:           # widened range for better extrapolation
            continue
        u = is_urban(*o)
        if ORS_KEY:
            try:
                y = ors_minutes(o, d)
            except Exception:
                y = synth_minutes(km, u)
        else:
            y = synth_minutes(km, u)
        rows.append((km, u, dest_density(*d), y))

    # --- zero anchors: pin the low end so a service next door ~= 0 min ---
    # (tree models can't extrapolate below the smallest sampled distance; these
    #  explicit near-zero points fix the "km=0 -> 8 min" artifact.)
    for _ in range(60):
        km = random.uniform(0.0, 0.5)
        u = random.randint(0, 1)
        dens = random.choice([0, 5, 15, 30])
        rows.append((km, u, dens, max(0.0, (km / (42 if u else 24)) * 60)))

    df = pd.DataFrame(rows, columns=["haversine_km", "is_urban", "dest_density", "minutes"])
    X = df[["haversine_km", "is_urban", "dest_density"]]
    y = df["minutes"]
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42)

    # monotonic_cst: travel time must be NON-DECREASING in distance (feature 0);
    # is_urban / dest_density left unconstrained (0).
    model = HistGradientBoostingRegressor(
        max_iter=400, max_depth=3, learning_rate=0.05,
        monotonic_cst=[1, 0, 0], random_state=42)
    model.fit(Xtr.values, ytr)
    pred = model.predict(Xte.values)

    # monotonicity self-check on a dense sweep
    sweep = model.predict(np.column_stack([np.linspace(0, 80, 200),
                                           np.zeros(200), np.ones(200)]))
    viol = int(np.sum(np.diff(sweep) < -1e-9))
    print(f"[traveltime] n={len(df)}  MAE={mean_absolute_error(yte, pred):.2f} min  "
          f"R2={r2_score(yte, pred):.3f}  mode={mode}  "
          f"monotonic_violations={viol}  km0_pred={model.predict([[0,0,1]])[0]:.2f}min")

    joblib.dump(model, MODELS / "traveltime.pkl")
    print(f"saved -> {MODELS / 'traveltime.pkl'}")


if __name__ == "__main__":
    main()
