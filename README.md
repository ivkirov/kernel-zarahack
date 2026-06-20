# The Time Poverty Matrix — *The Geography of Lost Time*

Quantifies the invisible **"time tax"** that infrastructure gaps impose on vulnerable
populations in Bulgaria — children 0–6 (kindergartens/schools) and seniors 65+
(clinics/hospitals) — and renders it on an interactive map. Built on **real open data**
(OpenStreetMap + NSI census + GeoNames) for all 28 provinces.

The app has **two modes** plus an **AI recommender**:

- **🏛 Municipal Infrastructure Optimization** — see systemic time-loss across a
  province, click the map to *simulate* building a facility and watch the annual
  "wasted hours saved", or press **AI: Recommend best sites** to have a trained model
  propose the highest-impact locations.
- **🏠 Personal Relocation Planner** — drop two pins (current vs. prospective home) and
  compare your weekly commute time-tax between them.

---

## Architecture (everything runs locally)

```
                          ┌──────────────── your machine ─────────────────────┐
  Browser  ──http──▶  frontend  ──┬─▶ backend-api (Java/Spring) :8080 ──JDBC──┐ │
  :5500               Tailwind +  │     matrix · simulate · personal-compare  │ │
  (Leaflet UI)        Leaflet     │                                           ▼ │
                                  └─▶ ml-service (Python/FastAPI) :8000   PostgreSQL :5432
                                        AI recommend · travel-time          (local)
                                        (runs from cached model bundle —
                                         no DB or datasets needed)
            data-engine (Python ETL)  ──psycopg2──▶  PostgreSQL  (one-time seed)
```

| Component | Tech | Port | Role |
|---|---|---|---|
| `backend-api/` | Java 21 · Spring Boot 3 · JPA | **8080** | matrix / simulate / personal-compare REST API |
| `ml-service/` | Python 3 · FastAPI · scikit-learn / XGBoost | **8000** | trained **AI bots**: placement recommender + travel-time model |
| `frontend/` | Tailwind CSS · Leaflet.js | **5500** | dark dashboard + interactive map |
| `data-engine/` | Python · pyosmium · pandas | — | one-time ETL that seeds PostgreSQL from `datasets/` |
| PostgreSQL | local | **5432** | `infrastructure_nodes` + `demographic_weights` |

> **OpenKBS** (`openkbs.json`, `functions/`, `site/`) is the dev playground only —
> nothing is deployed there. The whole stack runs on your machine.

---

## Repository map

```
kernel-zarahack/
├── README.md                ← you are here
├── .env.example             # local Postgres credentials template
├── datasets/                # raw OSM / NSI / GeoNames (gitignored — see docs/data-sources.md)
├── backend-api/             # Java Spring Boot REST API (:8080)
├── data-engine/             # Python ETL → seeds Postgres (run once)
├── ml-service/              # Python AI sidecar (:8000) — placement + travel-time models
│   ├── models/              #   trained .pkl bundle + cached features (ships in git, ~3 MB)
│   ├── README.md            #   model details & metrics
│   └── INTEGRATION.md       #   how the models plug in + how to move them between machines
├── frontend/                # Tailwind + Leaflet SPA (:5500)
├── docs/data-sources.md     # data provenance & fusion method
└── spec/                    # build plans (municipal + dual-mode framework)
```

---

## Prerequisites

- **Java 21+** and **Maven** (`mvn`)
- **Python 3.11+** (`python3`, `pip`)
- **Node.js 18+** (`npm`) — for Tailwind + the dev server
- **PostgreSQL 14+** running locally

---

## How to run the project

Five steps. Do **0–2 once**; **3–5** are the day-to-day "bring it up" steps.
Use a separate terminal per long-running server (backend, ML, frontend).

### 0. Database — create it once
```bash
# install/start postgres for your OS, then:
sudo -u postgres psql <<'SQL'
CREATE ROLE tpm_app WITH LOGIN PASSWORD 'change_me_locally';
CREATE DATABASE timepoverty OWNER tpm_app;
GRANT ALL PRIVILEGES ON DATABASE timepoverty TO tpm_app;
SQL
```

### 1. Environment — fill in `.env`
```bash
cp .env.example .env          # then set PGPASSWORD etc. to match step 0
set -a; source .env; set +a   # export PG* into THIS shell (re-run in new terminals)
```

### 2. Seed the database (one-time ETL)
Requires the raw files in `datasets/` (see `docs/data-sources.md`).
```bash
cd data-engine
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python run_pipeline.py        # 00 schema → 01 OSM → 02 NSI → 03 seed  (all 28 provinces)
```

### 3. Backend API — `:8080`
```bash
cd backend-api
mvn spring-boot:run
# verify:
curl "http://localhost:8080/api/v1/time-poverty/matrix?district=Pazardzhik" | head -c 200
```

### 4. AI sidecar (the bots) — `:8000`
Runs from the committed model bundle — **no Postgres, no datasets needed**.
```bash
cd ml-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --port 8000
# verify:
curl "http://localhost:8000/api/ml/recommend?amenity=kindergarten&top=3"
```

### 5. Frontend — `:5500`
```bash
cd frontend
npm install
npm run build:css            # compile Tailwind → dist/output.css
npm run serve                # live-server on http://localhost:5500
```

Open **http://localhost:5500** → pick a mode.

---

## Using the app

**Municipal mode**
1. Choose a province (or *All Bulgaria*) and an amenity (kindergarten / school / clinic / hospital).
2. **Click the map** → simulates placing that facility; the HUD animates *Annual Hours Saved*, people impacted, neighborhoods improved.
3. **AI: Recommend best sites** → the placement model proposes the top-3 highest-impact locations as ranked green markers (works even if the backend DB isn't seeded — it's served by `ml-service`).

**Personal mode**
1. Drop **Current** (red) and **Prospective** (green) pins.
2. Toggle household needs (children / senior care).
3. See your weekly time-tax for each home and the efficiency shift between them.

---

## The AI bots (`ml-service/`)

Two models **trained on this project's real datasets** — no GPU, ~1 MB:

| Bot | What it does | Quality |
|---|---|---|
| **Travel-time** | learns real travel minutes (monotonic in distance) vs a flat speed proxy | R² 0.95, MAE ~7 min |
| **Placement** (children + seniors) | predicts annual hours saved by a new facility → recommends best sites | R² 0.86 / 0.85, top-3 = true simulation |

The models live in `ml-service/models/` (committed; the service runs from them with no
datasets/DB). Stress-test them with `python ml-service/diagnose.py`. Full details:
[`ml-service/README.md`](ml-service/README.md) · integration & model distribution:
[`ml-service/INTEGRATION.md`](ml-service/INTEGRATION.md).

---

## Quick start (TL;DR)

```bash
# one-time: DB (step 0) · cp .env.example .env · seed (step 2) ·
#           pip install in data-engine + ml-service · (cd frontend && npm install && npm run build:css)
set -a; source .env; set +a

# three terminals:
( cd backend-api && mvn spring-boot:run )                                  # :8080
( cd ml-service  && source venv/bin/activate && uvicorn app:app --port 8000 )  # :8000
( cd frontend    && npm run serve )                                        # :5500
# → http://localhost:5500
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend `UnknownHostException` / auth failed | `set -a; source .env; set +a` in that terminal, restart |
| `Schema-validation: missing table` | run `data-engine/run_pipeline.py` before the backend |
| "AI: Recommend" button errors | is `ml-service` up on `:8000`? `curl localhost:8000/health` |
| Frontend CORS error | backend allows `:5500` (CorsConfig); ML service allows `:5500` too |
| Map loads but counters stay 0 | check `frontend/src/config.js` URLs; curl the matrix endpoint |
| `pyosmium` MemoryError on the `.pbf` | see `data-engine` notes (use a sparse index) |

Data provenance & method: [`docs/data-sources.md`](docs/data-sources.md).
