"""Read-only diagnostics: stress-test both models for edge cases & smartness.
Does NOT modify any model. Run: python diagnose.py
"""

import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.stats import spearmanr

import dataload
import sim
from sim import _haversine_vec

warnings.filterwarnings("ignore")
M = Path("models")
BG_BBOX = (22.30, 41.20, 28.65, 44.22)


def hr(t):
    print("\n" + "=" * 72 + f"\n{t}\n" + "=" * 72)


# --------------------------------------------------------------------------- #
# TRAVEL-TIME MODEL
# --------------------------------------------------------------------------- #
def diagnose_traveltime():
    hr("BOT #1 — TRAVEL-TIME MODEL  (production path: sim.predict_minutes_vec, clamped)")

    def P(km, u, d):
        return float(sim.predict_minutes_vec(np.array([km]), np.array([u]), np.array([d]))[0])

    # 1. zero distance (a service next door must be ~0, never negative)
    for u in (0, 1):
        m = P(0.0, u, 5)
        print(f"  km=0   is_urban={u}: {m:7.2f} min   {'<-- NEGATIVE!' if m < 0 else 'OK'}")

    # 2. monotonicity in distance (must be non-decreasing)
    for u, dens in [(1, 10), (0, 1)]:
        kms = np.linspace(0, 60, 61)
        preds = sim.predict_minutes_vec(kms, np.full(61, u), np.full(61, dens))
        viol = int(np.sum(np.diff(preds) < -1e-6))
        print(f"  monotonic sweep urban={u} dens={dens}: {viol} non-increasing / 60   "
              f"min={preds.min():.1f} max={preds.max():.1f} "
              f"{'OK' if viol == 0 else '<-- NON-MONOTONIC'}")

    # 3. extrapolation beyond training range
    for km in (60, 80, 120, 200):
        m = P(km, 0, 1)
        print(f"  km={km:3d} (rural): {m:7.2f} min  -> implied {km/(m/60):5.1f} km/h")

    # 4. negatives over a realistic grid (production path)
    neg = 0
    n = 0
    for km in np.linspace(0, 60, 40):
        for u in (0, 1):
            for d in (0, 5, 30):
                if P(km, u, d) < 0:
                    neg += 1
                n += 1
    print(f"  negative predictions in grid: {neg}/{n}   {'OK' if neg == 0 else '<-- LEAK'}")

    # 5. implied local speeds (sensibility)
    print("  implied speed at typical local distances:")
    for km in (2, 5, 10, 20):
        mu, mr = P(km, 1, 10), P(km, 0, 1)
        print(f"    {km:2d} km -> urban {mu:5.1f} min ({km/(mu/60):4.1f} km/h) | "
              f"rural {mr:5.1f} min ({km/(mr/60):4.1f} km/h)")


# --------------------------------------------------------------------------- #
# PLACEMENT MODEL — rebuild ground truth, compare surrogate vs true simulation
# --------------------------------------------------------------------------- #
def _build_truth(grid=34, model_file="placement.pkl"):
    P = joblib.load(M / model_file)
    group = P["group"]
    cells_all = pd.read_csv(M / "_weights_cache.csv")
    nodes = pd.read_csv(M / "_nodes_cache.csv")
    cells, serving, is_urban = sim.prepare_group(cells_all, nodes, group)
    base_min = cells["base_min"].values

    n_lat, n_lon = nodes.lat.values, nodes.lon.values
    c_lat, c_lon, c_pop = cells.lat.values, cells.lon.values, cells.population.values

    rows = []
    min_lon, min_lat, max_lon, max_lat = BG_BBOX
    for la in np.linspace(min_lat, max_lat, grid):
        for lo in np.linspace(min_lon, max_lon, grid):
            d = _haversine_vec(la, lo, c_lat, c_lon)
            if c_pop[d < 15].sum() == 0:
                continue
            cand_dens = int(np.sum(_haversine_vec(la, lo, n_lat, n_lon) < 5))
            true_hs = sim.hours_saved(la, lo, cells, base_min, is_urban, group, cand_dens)
            rows.append([la, lo] + sim.candidate_features(la, lo, cells, nodes) + [true_hs])
    cols = ["lat", "lon"] + sim.PLACEMENT_FEATURES + ["true_hs"]
    return P, pd.DataFrame(rows, columns=cols)


def diagnose_placement():
    hr("BOT #2 — PLACEMENT MODEL")
    P, df = _build_truth(grid=34)
    model, feats = P["model"], P["features"]
    df["pred_hs"] = sim.predict_hours(P, df[feats].values)   # log-aware + clamp (production path)

    # 1. feature importances (lat/lon reliance = memorization risk)
    imp = dict(zip(feats, model.feature_importances_))
    print("  feature importances:")
    for k, v in sorted(imp.items(), key=lambda x: -x[1]):
        flag = "  <-- geo memorization risk" if k in ("lat", "lon") and v > 0.15 else ""
        print(f"    {k:26s} {v:6.3f}{flag}")
    geo = imp.get("lat", 0) + imp.get("lon", 0)
    print(f"  total lat+lon importance: {geo:.3f}  "
          f"{'<-- HIGH (overfits location)' if geo > 0.3 else 'OK'}")

    # 2. negative predictions (savings can't be < 0)
    neg = int(np.sum(df.pred_hs < 0))
    print(f"  negative hours-saved predictions: {neg}/{len(df)}  "
          f"(min pred = {df.pred_hs.min():,.0f})  {'<-- needs clamp' if neg else 'OK'}")

    # 3. surrogate fidelity: rank agreement vs TRUE simulation
    rho = spearmanr(df.true_hs, df.pred_hs).statistic
    print(f"  Spearman rank corr (surrogate vs true sim): {rho:.3f}  "
          f"{'OK' if rho > 0.85 else '<-- weak ranking'}")

    # 4. top-K overlap: do surrogate's best sites match the TRUE best sites?
    for k in (3, 10):
        true_top = set(df.sort_values("true_hs", ascending=False).head(k).index)
        pred_top = set(df.sort_values("pred_hs", ascending=False).head(k).index)
        ov = len(true_top & pred_top)
        print(f"  top-{k} overlap (true vs surrogate): {ov}/{k}")

    # 5. error on the surrogate's OWN top-3 picks (what the demo shows)
    print("  surrogate's top-3 picks — predicted vs TRUE:")
    for _, r in df.sort_values("pred_hs", ascending=False).head(3).iterrows():
        err = (r.pred_hs - r.true_hs) / max(r.true_hs, 1) * 100
        print(f"    ({r.lat:.2f},{r.lon:.2f}) pred={r.pred_hs:>12,.0f}  "
              f"true={r.true_hs:>12,.0f}  err={err:+6.1f}%")

    # 6. diversity: are the top-3 distinct or clustered in one spot?
    top3 = df.sort_values("pred_hs", ascending=False).head(3)[["lat", "lon"]].values
    dmin = min(_haversine_vec(top3[i][0], top3[i][1],
                              np.array([top3[j][0]]), np.array([top3[j][1]]))[0]
               for i in range(3) for j in range(3) if i != j)
    print(f"  min distance between top-3 picks: {dmin:.1f} km  "
          f"{'<-- clustered/redundant' if dmin < 5 else 'OK (spread out)'}")

    # 7. coverage: which groups have a trained model?
    covered = sorted(joblib.load(f)["group"] for f in M.glob("placement_*.pkl"))
    both = {"children_0_6", "seniors_65p"}
    print(f"  amenity coverage: groups trained = {covered}  "
          f"{'OK (both cohorts)' if both.issubset(covered) else '<-- missing a cohort'}")


if __name__ == "__main__":
    diagnose_traveltime()
    diagnose_placement()
    print()
