# ml-service — Personal Models (Options 2 & 3b)

Two models **trained on our own datasets** (`../datasets`), the "personal models"
for The Time Poverty Matrix. CPU-only, no GPU, train in seconds–minutes.

> **Wired into this app.** Runs as a Python sidecar on **`:8000`**, beside the Java
> backend (`:8080`) and frontend (`:5500`). The municipal dashboard's **"AI:
> Recommend best sites"** button calls `GET /api/ml/recommend` (see
> `frontend/src/app.js → recommendSites()`, URL from `config.js → ML_BASE_URL`).
> It speaks the project's **Latin** province names and runs from the cached model
> bundle alone — **no Postgres and no `../datasets` needed at runtime**. Start it
> with `uvicorn app:app --port 8000` *(first time:* `pip install -r requirements.txt`*)*.
> See [`INTEGRATION.md`](./INTEGRATION.md) for the full wiring + how to ship models.

| Model | File | What it does | Quality |
|---|---|---|---|
| **Travel-time** (Option 2) | `traveltime.pkl` | predicts real travel minutes vs the flat `haversine ÷ 4.5` proxy; monotonic in distance | R² 0.95, MAE ~7 min |
| **Placement / children** (Option 3b) | `placement_children_0_6.pkl` | annual hours saved by a new kindergarten → recommends best sites | R² 0.87, top-3 = true sim |
| **Placement / seniors** (Option 3b) | `placement_seniors_65p.pkl` | annual hours saved by a new clinic for seniors | R² 0.85 |

`placement.pkl` is a copy of the last-trained group (default = children) kept for
back-compat; `app.py` loads the group-specific files into a registry.

Models are **location-free and baseline-aware** — they learn from *how much
currently-wasted travel time is reachable near a candidate*, not from raw
coordinates. Run `python diagnose.py` to stress-test them for edge cases.

## Data fusion (how every dataset is used)

```
NSI Excel (age × district)  ─┐
GeoNames BG.txt (towns+pop) ─┼─▶ 349 settlement demand points (children_0_6, seniors_65p)
                             │        │
OSM .pbf (2,772 services) ───┴────────┤
                                      ▼
                          traveltime.pkl ──▶ realistic minutes
                                      │
                       candidate-site sweep (simulation)
                                      ▼
                          (features → hours_saved) labels
                                      ▼
                               placement.pkl
                                      ▼
                       GET /api/ml/recommend → top-N sites
```

- **NSI** gives age-band population per district; children 0–6 = `age0 + age1-4 + 0.4×age5-9`, seniors 65+ = sum of 65-69…100+. National totals reconcile exactly (399,375 / 1,557,851).
- **GeoNames** distributes each district's demographics across its real towns (proportional to town population), turning 28 district points into **349 located settlements**.
- **OSM** provides the existing service supply (147 kindergartens, 234 schools, 204 hospitals, 567 clinics, 1,620 pharmacies).

## Setup & train

```bash
cd ml-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 1. cache OSM node extraction (~50s, one-time) — produces models/_nodes_cache.csv
python -c "import dataload, pandas as pd; dataload.load_nodes().to_csv('models/_nodes_cache.csv', index=False)"

# 2. train (traveltime FIRST — placement depends on it)
python train_traveltime.py                       # -> traveltime.pkl  (R2 0.95)
python train_placement.py                        # -> placement_children_0_6.pkl (R2 0.87)
PLACE_AMENITY=clinic python train_placement.py   # -> placement_seniors_65p.pkl  (R2 0.85)

# 3. stress-test for edge cases (monotonicity, negatives, geo-memorization, ranking)
python diagnose.py
```

**Optional — real travel-time labels:** set `ORS_API_KEY=<openrouteservice key>`
before `train_traveltime.py` to label OD pairs with real routing instead of the
synthetic speed curve.

## Serve

```bash
uvicorn app:app --port 8000
```

- `GET  /health`
- `POST /api/ml/traveltime`  body `{"km":12,"is_urban":0,"dest_density":1}` → `{"minutes":...}`
- `GET  /api/ml/recommend?amenity=kindergarten&district=Пазарджик&top=3` → top build
  sites (omit `district` for national; `amenity=clinic` uses the seniors model)

## Notes / limitations

- Demand is settlement-level via GeoNames (~82% of NSI population maps to a listed
  town; rural population outside listed towns is dropped). Good enough for the demo;
  improves with a finer settlement coordinate set.
- `traveltime.pkl` defaults to **synthetic** labels (urban 42 km/h, rural 24 km/h +
  noise). Swap in ORS for real labels when an API key is available.
- `models/_nodes_cache.csv` is a build artifact (regenerate from the `.pbf`).
- These file-based loaders mirror the app's `infrastructure_nodes` /
  `demographic_weights` tables, so the same `.pkl` models work unchanged once the
  main app's Postgres is seeded.
