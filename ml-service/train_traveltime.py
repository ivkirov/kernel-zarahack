"""OPTION 2 — Learned travel-time model.

Predicts real travel minutes from [haversine_km, is_urban, dest_density],
replacing the flat `haversine / 4.5 km/h` proxy.

Labels:
  - Mode A (REAL, default when ORS_API_KEY is set): query OpenRouteService for
    real driving times. Origins/destinations are sampled from REAL coordinates
    (GeoNames settlements -> OSM facility nodes) so every endpoint is on the road
    network and routable — this both avoids ORS "off-road" rejections and makes the
    training distribution match the real use case ("settlement -> nearest service").
    Requests are throttled to respect ORS's free-tier rate limit, unroutable pairs
    are DROPPED (never silently faked), and the real/skipped counts are reported.
  - Mode B (synthetic, when no key): physics-based speed curve (urban faster than
    rural) + realistic noise. Still a *learned* curve, no constant assumed.

Trains on the actual OSM node geography + NSI×GeoNames settlements from ../datasets.
Saves models/traveltime.pkl.
"""

import os
import random
import time
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
N_SAMPLES = int(os.getenv("TT_SAMPLES", "800"))      # target REAL labels to collect
ORS_KEY = os.getenv("ORS_API_KEY")
# ORS free tier: 40 directions/min, 2000/day. Space calls to stay under the rate.
ORS_MIN_INTERVAL = float(os.getenv("ORS_MIN_INTERVAL", "1.6"))   # seconds between calls
ORS_MAX_CALLS = int(os.getenv("ORS_MAX_CALLS", "1600"))          # daily-budget guard
MODELS = Path(__file__).parent / "models"
MODELS.mkdir(exist_ok=True)


# --------------------------------------------------------------------------- #
# Real-coordinate OD sampling (routable endpoints)
# --------------------------------------------------------------------------- #
def load_settlement_coords():
    """Unique (lat, lon) of real settlements, from the cached weights or datasets."""
    cache = MODELS / "_weights_cache.csv"
    w = pd.read_csv(cache) if cache.exists() else dataload.load_weights_settlement()
    return w.drop_duplicates("settlement")[["lat", "lon"]].values


def load_node_coords():
    cache = MODELS / "_nodes_cache.csv"
    n = pd.read_csv(cache) if cache.exists() else dataload.load_nodes()
    return n[["lat", "lon"]].values


def sample_od(settlements, nodes, max_km=80.0):
    """Origin = a real settlement; destination = a real facility node within a
    realistic local radius of it (the 'travel to nearest service' trip). Both
    endpoints are real places, so ORS can route between them."""
    for _ in range(40):
        o = settlements[random.randrange(len(settlements))]
        d = nodes[random.randrange(len(nodes))]
        km = haversine_km(o[0], o[1], d[0], d[1])
        if 0.3 < km < max_km:
            return (float(o[0]), float(o[1])), (float(d[0]), float(d[1])), km
    return None


# --------------------------------------------------------------------------- #
# OpenRouteService driving time, with throttle + rate-limit retry.
# Returns minutes, or None for an unroutable / permanently-failing pair.
# --------------------------------------------------------------------------- #
_last_call = [0.0]


def ors_minutes(o, d, session):
    url = "https://api.openrouteservice.org/v2/directions/driving-car"
    body = {"coordinates": [[o[1], o[0]], [d[1], d[0]]]}
    headers = {"Authorization": ORS_KEY}
    for attempt in range(4):
        # throttle: keep at least ORS_MIN_INTERVAL between any two calls
        wait = ORS_MIN_INTERVAL - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()
        try:
            r = session.post(url, json=body, headers=headers, timeout=20)
        except Exception:
            time.sleep(2)
            continue
        if r.status_code == 200:
            return r.json()["routes"][0]["summary"]["duration"] / 60.0
        if r.status_code == 429:                       # rate limited -> back off
            reset = r.headers.get("X-Ratelimit-Reset")
            back = 5.0
            if reset and reset.isdigit():
                back = max(2.0, min(65.0, float(reset) - time.time()))
            time.sleep(back)
            continue
        # 404 / routing error (off-road, no path, etc.) -> unroutable, skip this pair
        return None
    return None


def synth_minutes(km, urban):
    speed = 42 if urban else 24            # km/h; denser roads near towns
    return (km / speed) * 60 * np.random.uniform(0.85, 1.25)


def make_feature_fns(nodes, weights):
    urban_pts = weights[["lat", "lon"]].values          # district centres = urban anchors
    node_pts = nodes[["lat", "lon"]].values

    def is_urban(lat, lon):
        return int(any(haversine_km(lat, lon, p[0], p[1]) < 15 for p in urban_pts))

    def dest_density(lat, lon):
        return int(np.sum([haversine_km(lat, lon, p[0], p[1]) < 5 for p in node_pts]))

    return is_urban, dest_density


def main():
    print("Loading datasets (NSI weights + OSM nodes)...")
    weights = dataload.load_weights()
    nodes = pd.read_csv(MODELS / "_nodes_cache.csv") if (MODELS / "_nodes_cache.csv").exists() \
        else dataload.load_nodes()
    is_urban, dest_density = make_feature_fns(nodes, weights)

    mode = "ORS" if ORS_KEY else "synthetic"
    rows = []

    if ORS_KEY:
        import requests
        session = requests.Session()
        settlements = load_settlement_coords()
        node_pts = load_node_coords()
        print(f"Collecting up to {N_SAMPLES} REAL ORS labels "
              f"(throttle {ORS_MIN_INTERVAL}s, budget {ORS_MAX_CALLS} calls)...")
        got = skipped = calls = 0
        t0 = time.time()
        while got < N_SAMPLES and calls < ORS_MAX_CALLS:
            od = sample_od(settlements, node_pts)
            if od is None:
                continue
            o, d, km = od
            calls += 1
            mins = ors_minutes(o, d, session)
            if mins is None or mins <= 0:
                skipped += 1
                continue
            rows.append((km, is_urban(*o), dest_density(*d), mins))
            got += 1
            if got % 50 == 0:
                rate = got / max(1e-9, (time.time() - t0)) * 60
                print(f"  {got}/{N_SAMPLES} real labels  (skipped {skipped} off-road, "
                      f"{calls} calls, {rate:.0f}/min)")
        print(f"  collected {got} real ORS labels; skipped {skipped} unroutable; "
              f"{calls} total calls in {(time.time()-t0)/60:.1f} min")
        if got < 100:
            raise SystemExit("Too few real ORS labels collected — aborting (check key/quota).")
    else:
        print(f"Building {N_SAMPLES} synthetic OD samples...")
        min_lon, min_lat, max_lon, max_lat = BG_BBOX
        for _ in range(N_SAMPLES):
            o = (random.uniform(min_lat, max_lat), random.uniform(min_lon, max_lon))
            d = (o[0] + random.uniform(-0.45, 0.45), o[1] + random.uniform(-0.45, 0.45))
            km = haversine_km(*o, *d)
            if km < 0.3 or km > 80:
                continue
            u = is_urban(*o)
            rows.append((km, u, dest_density(*d), synth_minutes(km, u)))

    # --- zero anchors: pin the low end so a service next door ~= 0 min ---
    # (tree models can't extrapolate below the smallest sampled distance; these
    #  explicit near-zero points fix the "km=0 -> 8 min" artifact. Physics pins,
    #  not synthetic noise, so they're valid in REAL mode too.)
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
    mae = mean_absolute_error(yte, pred)
    print(f"[traveltime] n={len(df)}  MAE={mae:.2f} min  "
          f"R2={r2_score(yte, pred):.3f}  mode={mode}  "
          f"mean_obs={y.mean():.1f}min  monotonic_violations={viol}  "
          f"km0_pred={model.predict([[0,0,1]])[0]:.2f}min")

    joblib.dump(model, MODELS / "traveltime.pkl")
    print(f"saved -> {MODELS / 'traveltime.pkl'}")


if __name__ == "__main__":
    main()
