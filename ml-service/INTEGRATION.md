# INTEGRATION.md — Wiring the Personal Models into Reclaim

How the two trained models (`traveltime.pkl`, `placement.pkl`) plug into the
running app, and how to **move the trained models between machines so nobody has
to retrain** (or even download the 167 MB raw datasets).

- [1. Architecture — where the ML service sits](#1-architecture)
- [2. Model 1 (travel-time) integration](#2-model-1--travel-time-integration)
- [3. Model 2 (placement) integration](#3-model-2--placement-integration)
- [4. Frontend wiring](#4-frontend-wiring)
- [5. Backend (Java) interplay](#5-backend-java-interplay)
- [6. Data source: file-based now → Postgres later](#6-data-source-file-based-now--postgres-later)
- [7. Running everything together](#7-running-everything-together)
- [8. Moving trained models between machines](#8-moving-trained-models-between-machines)  ← the "don't retrain" part

---

## 1. Architecture

The ML models are Python (`scikit-learn` / `xgboost` `.pkl`). The main backend is
Java. **We do not load `.pkl` into Java.** Instead the ML lives in a small
**sidecar service** next to the Java API:

```
                         ┌──────────────────────── localhost ────────────────────────┐
  Browser (5500) ──┬───▶ │ Java Spring Boot (8080)  baseline matrix + simulate        │
   Leaflet+Tailwind │     ├────────────────────────────────────────────────────────── │
                    └───▶ │ Python ml-service (8000) /traveltime, /recommend  ← MODELS │
                          └──────────────────┬─────────────────────────────────────────┘
                                             ▼
                              PostgreSQL (5432)  OR  cached CSVs (dataset-free)
```

- **Java `:8080`** stays exactly as designed — it owns the baseline Haversine
  `matrix`/`simulate`. **Zero Java changes are required** to ship the models.
- **Python `:8000`** owns the models and exposes the "smart" endpoints.
- The **frontend calls both** — `:8080` for the base map/scores, `:8000` for the
  ML-powered recommendations (and optionally learned travel time).

This is the lowest-risk integration: the two runtimes never share memory, only
HTTP + the same data.

---

## 2. Model 1 — travel-time integration

`traveltime.pkl` predicts real minutes from `[haversine_km, is_urban, dest_density]`.
There are **two integration levels** — pick based on time.

### Level A (already done) — internal use
The travel-time model is consumed *inside* the ml-service: the placement
simulation (`sim.py`) uses it to produce realistic ROI labels and live
recommendations. Nothing else needed; the model already improves every number the
recommender returns.

### Level B (optional) — expose learned travel time to the rest of the app
Endpoint already exists:

```
POST :8000/api/ml/traveltime
  body: {"km": 12.0, "is_urban": 0, "dest_density": 1}
  resp: {"minutes": 32.26}
```

Use it to upgrade the headline "Annual Wasted Hours" from the flat proxy to the
learned model. Two ways:

- **Frontend-side (simplest):** when showing a cell's travel time, call this
  endpoint instead of trusting the Java Haversine number.
- **Backend-side (cleanest, optional):** have Java call this endpoint when scoring,
  or — better for a hackathon — **precompute** `nearest_minutes` per cell in Python
  and write it to the `demographic_weights` table as a column the Java service just
  reads (see §6). This keeps the live request path pure-Java and fast.

> Recommendation: ship **Level A** for the demo; mention Level B as "the same model
> can refine the baseline matrix." Don't block the demo on Java↔Python plumbing.

---

## 3. Model 2 — placement integration

`placement.pkl` is the demo headline: it recommends the best build sites.

Endpoint (already working):

```
GET :8000/api/ml/recommend?amenity={a}&district={name}&top={N}&grid={G}
  • amenity  : kindergarten|school (children) or clinic|hospital|pharmacy (seniors); default kindergarten
  • district : NSI name, URL-encoded Cyrillic (e.g. %D0%9F%D0%B0%D0%B7...) ; omit for national
  • top      : how many sites to return (default 3)
  • grid     : sweep resolution (default 40)

resp:
{
  "district": "Пазарджик",
  "amenity": "kindergarten",
  "group": "children_0_6",
  "recommendations": [
    {"lat": 42.353, "lon": 23.925, "nearestTown": "Lesichovo", "predictedHoursSaved": 144087},
    ...
  ]
}
```

Top-N picks are spread across distinct towns (greedy non-maximum suppression,
`min_separation_km`, default 8 km). Unknown amenities return a clean error listing
the available ones.

Flow: user picks a district → hits "Recommend best sites" → ml-service sweeps a
candidate grid, scores each with the surrogate, returns top-N → frontend drops
glowing markers.

---

## 4. Frontend wiring

Add one config line and one button handler to the existing `frontend/`.

`frontend/src/config.js`:

```js
window.TPM.ML_BASE_URL = "http://localhost:8000/api/ml";
```

`frontend/index.html` — a button near the amenity selector:

```html
<button id="recommendBtn"
  class="metric-card !p-2 text-sm text-good hover:bg-panel">
  ✨ Recommend best sites
</button>
```

`frontend/src/app.js`:

```js
const ML_BASE = window.TPM.ML_BASE_URL;
const recoLayer = L.layerGroup().addTo(map);

async function recommendSites() {
  const d = encodeURIComponent(window.TPM.DISTRICT);   // Cyrillic-safe
  const amenity = document.getElementById("amenitySelect").value;   // kindergarten|clinic|...
  const res = await fetch(`${ML_BASE}/recommend?amenity=${amenity}&district=${d}&top=3`);
  const data = await res.json();

  recoLayer.clearLayers();
  data.recommendations.forEach((r, i) => {
    L.marker([r.lat, r.lon], { title: `#${i + 1}` })
      .addTo(recoLayer)
      .bindPopup(
        `<b>★ Recommended site #${i + 1}</b><br>` +
        `Build: ${data.amenity}<br>` +
        `Near: ${r.nearestTown}<br>` +
        `Predicted: <b>${r.predictedHoursSaved.toLocaleString()}</b> h/yr saved`)
      .openPopup();
    // optional: animate the HUD "Hours Saved" card with r.predictedHoursSaved
  });
}
document.getElementById("recommendBtn").addEventListener("click", recommendSites);
```

Optional — use the learned travel time when describing a clicked point:

```js
async function learnedMinutes(km, isUrban, destDensity) {
  const res = await fetch(`${ML_BASE}/traveltime`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ km, is_urban: isUrban, dest_density: destDensity }),
  });
  return (await res.json()).minutes;
}
```

CORS is already allowed for `http://localhost:5500` in `app.py`.

---

## 5. Backend (Java) interplay

You generally **don't** need to touch Java. If you want the Java service to use
learned travel time (Level B), the clean option that avoids cross-language model
loading:

1. In `ml-service`, add a one-shot script that computes `nearest_minutes` per cell
   with `traveltime.pkl` and `UPDATE`s a `nearest_minutes` column in
   `demographic_weights`.
2. Java reads that column instead of recomputing Haversine.

This keeps the live Java path fast and dependency-free, and the model still drives
the numbers. (For the hackathon, the recommend endpoint alone is the wow factor —
this is a stretch goal.)

---

## 6. Data source: file-based now → Postgres later

The loaders in `dataload.py` currently read `../datasets` directly (no DB needed),
and `app.py` reads **cached CSVs** so it runs even without the datasets present
(see §8). When the main app's Postgres is seeded, switch the source with a tiny
change — the models are unchanged:

```python
# dataload.py — add a DB-backed variant used when the app DB exists
def load_weights_settlement_db():
    import psycopg2, os
    dsn = dict(host=os.environ["PGHOST"], port=os.getenv("PGPORT", "5432"),
               dbname=os.environ["PGDATABASE"], user=os.environ["PGUSER"],
               password=os.environ["PGPASSWORD"], sslmode=os.getenv("PGSSLMODE", "disable"))
    with psycopg2.connect(**dsn) as c:
        return pd.read_sql("SELECT * FROM demographic_weights", c)
```

Because the file loaders already emit the **same columns** as the
`demographic_weights` / `infrastructure_nodes` tables, the `.pkl` models and `sim.py`
work identically whether the rows come from CSV or Postgres.

---

## 7. Running everything together

```bash
# terminal 1 — ML sidecar (serves the models)
cd ml-service && uvicorn app:app --port 8000

# terminal 2 — Java backend
cd backend-api && ./mvnw spring-boot:run

# terminal 3 — frontend
cd frontend && npm run serve
```

Add to the repo-root `dev.sh`:

```bash
echo "▶ ML service (FastAPI) on :8000"
( cd ml-service && source venv/bin/activate && uvicorn app:app --port 8000 ) &
ML_PID=$!
# add $ML_PID to the trap kill line
```

Smoke test:

```bash
curl -s localhost:8000/health
curl -s "localhost:8000/api/ml/recommend?top=3"           # national
```

---

## 8. Moving trained models between machines

**Goal: train once, run anywhere — no retraining, no 167 MB datasets on each PC.**

### 8.1 What actually needs to travel (the artifact bundle)

Everything the service needs at runtime lives in `ml-service/models/` — **1.4 MB total**:

| File | Size | Purpose | Needed to run? |
|---|---|---|---|
| `traveltime.pkl` | 340 KB | Option 2 model | ✅ |
| `placement_children_0_6.pkl` | 900 KB | Option 3b — kindergartens | ✅ |
| `placement_seniors_65p.pkl` | 880 KB | Option 3b — clinics | ✅ |
| `placement.pkl` | 900 KB | default copy (back-compat) | ✅ |
| `_nodes_cache.csv` | 160 KB | OSM service nodes (extracted once) | ✅ |
| `_weights_cache.csv` | 60 KB | settlement demand (NSI×GeoNames) | ✅ |

(`models/backup_*/` folders are local safety snapshots — **don't** ship them.)

`app.py` loads the two CSVs from cache when present, so **with this bundle the
service starts and serves correctly even if `../datasets/` does not exist on the
machine.** That is the whole point — teammates clone, get the bundle, run, done.

> The raw `datasets/` (esp. `bulgaria-260618.osm.pbf`, 167 MB) is **only** needed to
> *retrain* or *regenerate the caches*, not to run.

### 8.2 Recommended: commit the bundle to git (it's tiny)

1.4 MB is small enough to live in the repo directly. Add an allow-list to
`.gitignore` so the giant raw data stays out but the model bundle is tracked:

```gitignore
# keep raw datasets OUT of git (regenerate locally)
datasets/*.pbf
datasets/*.xlsx
datasets/*.zip

# but DO track the trained model bundle (tiny, portable)
!ml-service/models/
!ml-service/models/*.pkl
!ml-service/models/*_cache.csv

# never ship local backup snapshots
ml-service/models/backup_*/
```

Then:

```bash
git add ml-service/models/*.pkl ml-service/models/*_cache.csv
git commit -m "Add trained personal models + cached features (run without datasets)"
```

Now any teammate:

```bash
git clone <repo> && cd repo/ml-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --port 8000        # works immediately — no datasets, no training
```

### 8.3 If the bundle grows large (real settlement data) → Git LFS

If you later swap in finer-grained data and the `.pkl`s grow into tens of MB,
track them with [Git LFS](https://git-lfs.com) instead of plain git:

```bash
git lfs install
git lfs track "ml-service/models/*.pkl"
git add .gitattributes ml-service/models/*.pkl
git commit -m "Track models with LFS"
```

### 8.4 Alternative: release/shared-storage + fetch script

If you'd rather not version binaries at all, publish the bundle as a GitHub Release
asset (or a shared drive / S3 bucket) and fetch it:

```bash
# ml-service/fetch_models.sh
set -euo pipefail
DEST="$(dirname "$0")/models"; mkdir -p "$DEST"
BASE="https://github.com/<org>/<repo>/releases/download/models-v1"
for f in traveltime.pkl placement.pkl _nodes_cache.csv _weights_cache.csv; do
  curl -L -o "$DEST/$f" "$BASE/$f"
done
echo "Models downloaded to $DEST"
```

### 8.5 Portability rules (so a moved model still works)

- **Pin library versions.** A `.pkl` is only guaranteed to load on a compatible
  `scikit-learn` / `xgboost`. `requirements.txt` covers this; ideally pin exact
  versions before sharing (e.g. `scikit-learn==1.8.0`, `xgboost==2.1.x`).
- **Bundle the caches with the models.** A `.pkl` without `_nodes_cache.csv` /
  `_weights_cache.csv` will load but the service can't serve `/recommend`
  (it needs the demand + supply rows). Always move all four files together.
- **Joblib, not raw pickle.** Models are saved with `joblib.dump` — load with
  `joblib.load`. Same major Python is safest (these were built on 3.x).

### 8.6 When to actually retrain (vs just copy)

Copy the bundle in every normal case. Only **retrain** when:

| Trigger | Action |
|---|---|
| Real `ORS_API_KEY` available (replace synthetic travel times) | `ORS_API_KEY=… python train_traveltime.py` then `python train_placement.py` |
| New/updated NSI or OSM data | regenerate caches, then retrain both |
| Different target amenity (e.g. clinics for seniors) | `PLACE_AMENITY=clinic python train_placement.py` |
| Postgres becomes the source | point loaders at the DB (§6), regenerate caches |

Regenerate the caches before retraining on new data:

```bash
python -c "import dataload,pandas as pd; dataload.load_nodes().to_csv('models/_nodes_cache.csv',index=False)"
python -c "import dataload; dataload.load_weights_settlement().to_csv('models/_weights_cache.csv',index=False)"
```

> **Train order is fixed:** `train_traveltime.py` **before** `train_placement.py`
> — the placement labels are generated using the travel-time model.

---

## TL;DR

- Models run as a **Python sidecar on :8000**; Java and the frontend are untouched
  except one fetch call for `/recommend`.
- The **1.4 MB `models/` bundle** (2 `.pkl` + 2 cache CSVs) is fully portable and
  **runs with no datasets and no training** — commit it to git and teammates are
  ready in one `pip install`.
- Retrain only when the data, the amenity, or the routing source changes.
