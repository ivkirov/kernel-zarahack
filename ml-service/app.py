"""Time Poverty Matrix — ML service (FastAPI, localhost:8000).

Serves the two trained models to the frontend:
  POST /api/ml/traveltime        -> learned travel-time prediction (Option 2)
  GET  /api/ml/recommend         -> top-N best build sites (Option 3b)

Loads data from cached CSVs at startup (dataset-free; see INTEGRATION.md). The same
models drop into the Postgres-backed app later unchanged.
"""

from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import dataload
import sim
from sim import _haversine_vec

MODELS = Path(__file__).parent / "models"
BG_BBOX = (22.30, 41.20, 28.65, 44.22)

def _resolve_district(district):
    """Normalize the incoming district: 'all'/empty -> None (nationwide), else the
    project's Latin province name as-is (the demand cache uses these directly)."""
    if not district or district.lower() == "all":
        return None
    return district


app = FastAPI(title="Time Poverty Matrix — ML Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5500", "http://127.0.0.1:5500"],
    allow_methods=["*"], allow_headers=["*"],
)

# --------------------------- load once at startup --------------------------- #
_W_CACHE = MODELS / "_weights_cache.csv"
WEIGHTS = pd.read_csv(_W_CACHE) if _W_CACHE.exists() else dataload.load_weights_settlement()
NODES = pd.read_csv(MODELS / "_nodes_cache.csv")

# registry: group -> trained payload  (children + seniors if both present)
PLACEMENT = {}
for f in MODELS.glob("placement_*.pkl"):
    p = joblib.load(f)
    PLACEMENT[p["group"]] = p
if not PLACEMENT:                                  # fallback to the default file
    p = joblib.load(MODELS / "placement.pkl")
    PLACEMENT[p["group"]] = p

# precompute baseline-aware cells per group ONCE (used for features at predict time)
PREP = {}
for group in PLACEMENT:
    cells, _serving, _is_urban = sim.prepare_group(WEIGHTS, NODES, group)
    PREP[group] = cells


class TravelReq(BaseModel):
    km: float
    is_urban: int = 0
    dest_density: int = 0


@app.get("/health")
def health():
    return {"status": "ok",
            "settlements": int(WEIGHTS.settlement.nunique()),
            "nodes": int(len(NODES)),
            "amenities": sorted({p["amenity"] for p in PLACEMENT.values()}),
            "groups": sorted(PLACEMENT.keys())}


@app.post("/api/ml/traveltime")
def traveltime(r: TravelReq):
    m = sim.predict_minutes_vec(np.array([r.km]),
                                np.array([r.is_urban]),
                                np.array([r.dest_density]))
    return {"minutes": round(float(m[0]), 2)}


@app.get("/api/ml/recommend")
def recommend(amenity: str = "kindergarten", district: str = None,
              top: int = 3, grid: int = 40, min_separation_km: float = 8.0):
    group = sim.AMENITY_GROUP.get(amenity)
    if group is None or group not in PLACEMENT:
        return {"error": f"no model for amenity '{amenity}'",
                "available": sorted({p["amenity"] for p in PLACEMENT.values()})}

    payload = PLACEMENT[group]
    cells = PREP[group]                            # full national cells (for features)
    n_lat, n_lon = NODES.lat.values, NODES.lon.values

    # candidate grid bbox: national, or restricted to the requested district.
    # Frontend sends Latin names / "all"; resolve to the cache's Cyrillic name.
    cyr = _resolve_district(district)
    if cyr:
        dcells = cells[cells.district == cyr]      # exact (София vs София (столица))
        if dcells.empty:
            return {"error": f"unknown district '{district}'"}
        bbox = (dcells.lon.min() - 0.1, dcells.lat.min() - 0.1,
                dcells.lon.max() + 0.1, dcells.lat.max() + 0.1)
        towns = dcells.drop_duplicates("settlement")
    else:
        bbox = BG_BBOX
        towns = cells.drop_duplicates("settlement")

    min_lon, min_lat, max_lon, max_lat = bbox
    cand = []
    for la in np.linspace(min_lat, max_lat, grid):
        for lo in np.linspace(min_lon, max_lon, grid):
            d = _haversine_vec(la, lo, cells.lat.values, cells.lon.values)
            if cells.population.values[d < 15].sum() == 0:
                continue
            feats = sim.candidate_features(la, lo, cells, NODES)
            cand.append((la, lo, feats))

    if not cand:
        return {"district": district or "Bulgaria", "amenity": amenity, "recommendations": []}

    X = np.array([c[2] for c in cand])
    preds = sim.predict_hours(payload, X)
    order = np.argsort(-preds)

    # greedy non-maximum suppression so the top-N aren't all the same town
    chosen = []
    for i in order:
        la, lo = cand[i][0], cand[i][1]
        if all(_haversine_vec(la, lo, np.array([c[0]]), np.array([c[1]]))[0] >= min_separation_km
               for c in chosen):
            chosen.append((la, lo, float(preds[i])))
        if len(chosen) >= top:
            break

    recs = []
    for la, lo, hs in chosen:
        di = _haversine_vec(la, lo, towns.lat.values, towns.lon.values)
        recs.append({"lat": round(la, 5), "lon": round(lo, 5),
                     "nearestTown": towns.iloc[int(di.argmin())].settlement,
                     "predictedHoursSaved": round(hs)})
    return {"district": district or "Bulgaria", "amenity": amenity,
            "group": group, "recommendations": recs}
