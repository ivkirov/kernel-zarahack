# Getting Started

Five steps. Do **0–2 once**; **3–5** are the day-to-day "bring it up" steps. Use a
separate terminal per long-running server (backend, ML, frontend).

## Prerequisites

- **Java 25+** and **Maven** (`mvn`)
- **Python 3.11+** (`python3`, `pip`)
- **Node.js 18+** (`npm`) — for Tailwind + the dev server
- **PostgreSQL 14+** running locally

## 0. Database — create it once

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE tpm_app WITH LOGIN PASSWORD 'change_me_locally';
CREATE DATABASE timepoverty OWNER tpm_app;
GRANT ALL PRIVILEGES ON DATABASE timepoverty TO tpm_app;
SQL
```

## 1. Environment — fill in `.env`

```bash
cp .env.example .env          # then set PGPASSWORD etc. to match step 0
set -a; source .env; set +a   # export PG* into THIS shell (re-run in new terminals)
```

The `PG*` vars (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE`)
are consumed by both the Java backend (`application.yml`) and the Python ETL
(`data-engine/config.py`).

## 2. Seed the database (one-time ETL)

Requires the raw files in `datasets/` (see [datasets.md](datasets.md)).

```bash
cd data-engine
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python run_pipeline.py        # 00 schema → 01 OSM → 02 NSI → 03 seed  (all 28 provinces, ~1.5 min)
```

Seed a single province instead of all 28:

```bash
TPM_NATIONWIDE=0 TPM_DISTRICT=Plovdiv ./venv/bin/python run_pipeline.py
```

Full pipeline details: [data-pipeline.md](data-pipeline.md).

## 3. Backend API — `:8080`

```bash
cd backend-api
mvn spring-boot:run
# verify:
curl "http://localhost:8080/api/v1/time-poverty/matrix?district=Pazardzhik" | head -c 200
```

## 4. AI sidecar (the bots) — `:8000`

Runs from the committed model bundle — **no Postgres, no datasets needed**.

```bash
cd ml-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --port 8000
# verify:
curl "http://localhost:8000/api/ml/recommend?amenity=kindergarten&top=3"
```

## 5. Frontend — `:5500`

```bash
cd frontend
npm install
npm run build:css            # compile Tailwind → dist/output.css
npm run serve                # live-server on http://localhost:5500
```

Open **http://localhost:5500** → pick a mode.

## Quick start (TL;DR)

```bash
# one-time: DB (step 0) · cp .env.example .env · seed (step 2) ·
#           pip install in data-engine + ml-service · (cd frontend && npm install && npm run build:css)
set -a; source .env; set +a

# three terminals:
( cd backend-api && mvn spring-boot:run )                                      # :8080
( cd ml-service  && source venv/bin/activate && uvicorn app:app --port 8000 )  # :8000
( cd frontend    && npm run serve )                                            # :5500
# → http://localhost:5500
```

## Using the app

**Municipal mode**
1. Choose a province (or *All Bulgaria*) and an amenity (kindergarten / school / clinic / hospital).
2. **Click the map** → simulates placing that facility; the HUD animates *Annual Hours
   Saved*, people impacted, neighborhoods improved.
3. **AI: Recommend best sites** → the placement model proposes the top-3 highest-impact
   locations as ranked green markers (works even if the backend DB isn't seeded — served by
   `ml-service`).

**Personal mode**
1. Drop **Current** (red) and **Prospective** (green) pins.
2. Toggle household needs (children / senior care, or fine-grained per-amenity needs).
3. See your weekly time-tax for each home and the efficiency shift between them.

## Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| Backend `UnknownHostException` / auth failed | `set -a; source .env; set +a` in that terminal, restart |
| `Schema-validation: missing table` | run `data-engine/run_pipeline.py` before the backend |
| "AI: Recommend" button errors | is `ml-service` up on `:8000`? `curl localhost:8000/health` |
| Frontend CORS error | backend allows `:5500` (CorsConfig); ML service allows `:5500` too |
| Map loads but counters stay 0 | check `frontend/src/config.js` URLs; curl the matrix endpoint |
| `pyosmium` MemoryError on the `.pbf` | see `data-engine` notes (use a sparse index) |
