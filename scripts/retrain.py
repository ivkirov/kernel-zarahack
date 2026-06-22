#!/usr/bin/env python3
"""Reclaim — end-to-end ML retraining entry point.

Runs the full model pipeline for ONE region, driven entirely by a region config
(``config/region.yaml`` by default — see ``config/region.example.yaml``). No
region detail is baked into this script; point it at a new config and it retrains
for a new country with no source edits.

Pipeline
--------
    1. extract    rebuild the model caches from ../datasets (OSM nodes + the
                  NSI×GeoNames settlement demand) -> ml-service/models/*.csv
    2. traveltime train the HGBR transit-time model      -> traveltime.pkl
    3. placement  train one XGBoost placement surrogate per demand group
                  (kindergarten -> children, clinic -> seniors, …)
                  -> placement_<group>.pkl  (+ placement.pkl alias)

Usage
-----
    python scripts/retrain.py                                  # use config/region.yaml
    python scripts/retrain.py --config config/region.yaml      # explicit
    python scripts/retrain.py --amenities kindergarten,clinic  # groups to model
    python scripts/retrain.py --skip-extract                   # reuse caches
    ORS_API_KEY=... python scripts/retrain.py                  # real routing labels

Prereqs: the raw datasets named in the region config must be present in the
datasets dir, and ml-service deps installed (`pip install -r ml-service/requirements.txt`).
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ML = REPO / "ml-service"
MODELS = ML / "models"

# Make the ml-service package importable so we can read the region config + the
# amenity->group map straight from the same loader the training code uses.
sys.path.insert(0, str(ML))


def _run(cmd, env, label):
    print(f"\n\033[1m=== {label} ===\033[0m\n  $ {' '.join(cmd)}")
    res = subprocess.run(cmd, cwd=ML, env=env)
    if res.returncode != 0:
        raise SystemExit(f"[retrain] step failed: {label} (exit {res.returncode})")


def _amenities_for_groups(region) -> list:
    """One representative amenity per demand group, so every group gets a model.
    Picks the first amenity mapped to each group in the region's amenity_map."""
    seen, picks = set(), []
    for amenity, (_svc, group) in region.amenity_map().items():
        if group not in seen:
            seen.add(group)
            picks.append(amenity)
    return picks


def build_caches(env):
    """Regenerate the OSM node + settlement-demand caches the models train on."""
    MODELS.mkdir(exist_ok=True)
    extract = (
        "import dataload, pandas as pd;"
        "dataload.load_nodes().to_csv('models/_nodes_cache.csv', index=False);"
        "dataload.load_weights_settlement().to_csv('models/_weights_cache.csv', index=False);"
        "print('  caches: _nodes_cache.csv + _weights_cache.csv')"
    )
    _run([sys.executable, "-c", extract], env, "1/3  extract — rebuild caches from datasets")


def main():
    ap = argparse.ArgumentParser(description="Retrain the Reclaim ML pipeline for a region.")
    ap.add_argument("--config", help="Path to a region YAML (sets REGION_CONFIG).")
    ap.add_argument("--amenities",
                    help="Comma-separated amenities to train placement for "
                         "(default: one per demand group in the region config).")
    ap.add_argument("--skip-extract", action="store_true",
                    help="Reuse existing model caches instead of rebuilding them.")
    ap.add_argument("--skip-traveltime", action="store_true",
                    help="Skip training the travel-time model (keep traveltime.pkl).")
    ap.add_argument("--skip-placement", action="store_true",
                    help="Skip training the placement models.")
    args = ap.parse_args()

    env = os.environ.copy()
    if args.config:
        env["REGION_CONFIG"] = str(Path(args.config).resolve())
        os.environ["REGION_CONFIG"] = env["REGION_CONFIG"]   # for our own import below

    import region   # resolved against REGION_CONFIG / config/region.yaml / example
    cfg_path = region.load()["_path"]

    print(f"Region    : {region.name()}")
    print(f"Config    : {cfg_path}")
    print(f"BBox      : {region.bbox()}")
    print(f"Provinces : {len(region.provinces())}")
    print(f"Datasets  : {region.datasets_dir()}")

    # travel-time MUST exist before placement (placement scores via traveltime.pkl).
    if not args.skip_extract:
        build_caches(env)
    elif not (MODELS / "_nodes_cache.csv").exists():
        raise SystemExit("[retrain] --skip-extract but model caches are missing; "
                         "run once without it to build them.")

    if not args.skip_traveltime:
        _run([sys.executable, "train_traveltime.py"], env,
             "2/3  traveltime — HGBR transit-time model")
    else:
        print("\n=== 2/3  traveltime — SKIPPED ===")

    if not args.skip_placement:
        amenities = ([a.strip() for a in args.amenities.split(",") if a.strip()]
                     if args.amenities else _amenities_for_groups(region))
        for i, amenity in enumerate(amenities, 1):
            step_env = dict(env, PLACE_AMENITY=amenity)
            _run([sys.executable, "train_placement.py"], step_env,
                 f"3/3  placement [{i}/{len(amenities)}] — XGBoost surrogate ({amenity})")
    else:
        print("\n=== 3/3  placement — SKIPPED ===")

    print("\n\033[1m[retrain] done.\033[0m  Artifacts in ml-service/models/:")
    for f in sorted(MODELS.glob("*.pkl")):
        print(f"  - {f.name}")


if __name__ == "__main__":
    main()
