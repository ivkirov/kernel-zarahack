"""OPTION 3b — Placement surrogate model.

Generates training labels by sweeping a grid of candidate build-sites through the
(vectorized) simulation -> "annual hours saved". Then trains an XGBoost surrogate
that predicts hours-saved from cheap location features, so we can score thousands
of candidates instantly and recommend the best sites.

Trains on the real OSM nodes + NSI-x-GeoNames settlement demand from ../datasets.
Saves models/placement.pkl.
"""

import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

import dataload
import sim
from sim import _haversine_vec

try:
    from xgboost import XGBRegressor
    _HAVE_XGB = True
except Exception:                                 # graceful fallback
    from sklearn.ensemble import GradientBoostingRegressor
    _HAVE_XGB = False

from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

BG_BBOX = (22.30, 41.20, 28.65, 44.22)            # min_lon, min_lat, max_lon, max_lat
GRID = int(os.getenv("PLACE_GRID", "44"))         # 44x44 = 1936 candidate sites
AMENITY = os.getenv("PLACE_AMENITY", "kindergarten")
MODELS = Path(__file__).parent / "models"
MODELS.mkdir(exist_ok=True)


# Features live in sim.py (shared by training, serving and diagnostics).
from sim import candidate_features, PLACEMENT_FEATURES as FEATURES


def main():
    group = sim.AMENITY_GROUP[AMENITY]
    print(f"Amenity={AMENITY}  group={group}  grid={GRID}x{GRID}")

    print("Loading datasets...")
    cells_all = dataload.load_weights_settlement()
    nodes = pd.read_csv(MODELS / "_nodes_cache.csv")
    # prepare_group attaches per-cell baseline minutes + current wasted hours
    cells, serving, is_urban = sim.prepare_group(cells_all, nodes, group)
    print(f"  {len(cells)} demand cells, {len(serving)} serving nodes")

    node_lat, node_lon = nodes["lat"].values, nodes["lon"].values
    base_min = cells["base_min"].values

    print("Sweeping candidate grid -> hours-saved labels...")
    min_lon, min_lat, max_lon, max_lat = BG_BBOX
    rows = []
    for la in np.linspace(min_lat, max_lat, GRID):
        for lo in np.linspace(min_lon, max_lon, GRID):
            cand_dens = int(np.sum(_haversine_vec(la, lo, node_lat, node_lon) < 5))
            y = sim.hours_saved(la, lo, cells, base_min, is_urban, group, cand_dens)
            rows.append([la, lo] + candidate_features(la, lo, cells, nodes) + [y])

    cols = ["lat", "lon"] + FEATURES + ["hours_saved"]
    df = pd.DataFrame(rows, columns=cols)
    df = df[df["demand_15km"] > 0].reset_index(drop=True)        # ignore empty sea/border cells
    print(f"  {len(df)} usable candidates; hours_saved max={df.hours_saved.max():.0f}")

    X, y = df[FEATURES], df["hours_saved"]           # raw target; lat/lon excluded
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42)

    if _HAVE_XGB:
        model = XGBRegressor(n_estimators=600, max_depth=4, learning_rate=0.04,
                             subsample=0.9, colsample_bytree=0.9,
                             reg_lambda=2.0, min_child_weight=3)
    else:
        model = GradientBoostingRegressor(n_estimators=600, max_depth=4, learning_rate=0.04)
    model.fit(Xtr.values, ytr)
    pred = np.clip(model.predict(Xte.values), 0, None)
    print(f"[placement] n={len(df)}  MAE={mean_absolute_error(yte, pred):.0f} h  "
          f"R2={r2_score(yte, pred):.3f}  backend={'xgboost' if _HAVE_XGB else 'sklearn'}")

    payload = {"model": model, "features": FEATURES, "amenity": AMENITY,
               "group": group, "log_target": False}
    joblib.dump(payload, MODELS / f"placement_{group}.pkl")    # group-specific
    joblib.dump(payload, MODELS / "placement.pkl")             # default = last trained
    print(f"saved -> placement_{group}.pkl  (+ placement.pkl)")


if __name__ == "__main__":
    main()
