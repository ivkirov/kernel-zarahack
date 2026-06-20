# Reclaim — *The Geography of Lost Time*

Quantifies the invisible **"time tax"** that infrastructure gaps impose on vulnerable
populations in Bulgaria — children 0–6 (kindergartens/schools) and seniors 65+
(clinics/hospitals/pharmacies) — and renders it on an interactive map. Built on **real open
data** (OpenStreetMap + NSI census + GeoNames) for all **28 provinces**: 2,772 supply nodes
and 14,476 demand cells.

For every settlement and cohort it computes the one-way travel time to the nearest serving
facility, turns that into **annual wasted hours** — **≈ 334 million hours/year across the whole
country** (the pilot province Stara Zagora accounts for ≈ 14.5M of that) — and lets you act
on it through three role-gated lenses plus an AI recommender:

- **🏛 Municipal Infrastructure Optimization** — see systemic time-loss across a province,
  **click the map** to simulate building a facility and watch the annual "wasted hours
  saved", or press **AI: Recommend best sites** to have a trained model propose the
  highest-impact locations.
- **🏠 Personal Relocation Planner** — drop two pins (current vs. prospective home) and
  compare your weekly commute time-tax between them, broken down by the services your
  household actually uses.
- **📡 Accountability Radar** — planned civic builds scraped from the public-procurement
  registry (AOP), audited against the model's optimal sites.

**Accounts, roles & paid tiers.** A login gate fronts the app; each account sees only the
lens its role allows — `FREE_USER` (limited relocation planner) plus the paid tiers
`PAID_USER` (t1, + AI explanation & area suggestions), `REPORTER` (t2, Radar) and
`MUNICIPALITY` (t3, municipal planner). Paid access is **admin-assigned**. The seeded admin
(`admin@gmail.com` / `P4$$w0rd!`) sees every lens plus a user-management panel.

Everything runs **locally**: a Java/Spring API (`:8080`), a Python/FastAPI ML sidecar
(`:8000`), a Tailwind + Leaflet frontend (`:5500`), a Python ETL, and local PostgreSQL.

---

## Documentation

The README is the entry point; the depth lives in [`docs/`](docs/).

| Doc | What's inside |
| :--- | :--- |
| [Overview](docs/overview.md) | What the project is, who it measures, what it produces |
| [Architecture](docs/architecture.md) | System shape, request flows, why two backends, repo map |
| [Getting Started](docs/getting-started.md) | Prerequisites, 5-step setup, using the app, troubleshooting |
| [Methodology](docs/methodology.md) | Cohorts, travel model, every scoring formula, assumptions |
| [Datasets](docs/datasets.md) | OSM / NSI / GeoNames sources, why a fusion was needed, the crosswalk |
| [Data Pipeline](docs/data-pipeline.md) | The `data-engine` ETL steps + the PostgreSQL schema |
| [Backend API](docs/backend-api.md) | Java/Spring service internals, config, the math methods |
| [ML Service](docs/ml-service.md) | The two model families, features, training, inference |
| [Frontend](docs/frontend.md) | Leaflet UI, mode routing, layers, caching, motion |
| [API Reference](docs/api-reference.md) | Every endpoint with request/response shapes + curl |

Component-level notes also live next to the code: [`ml-service/README.md`](ml-service/README.md)
and [`ml-service/INTEGRATION.md`](ml-service/INTEGRATION.md).

---

## Quick start (TL;DR)

Full instructions: [Getting Started](docs/getting-started.md). Requires Java 25+, Python
3.11+, Node 18+, and local PostgreSQL 14+.

```bash
# one-time: create DB · cp .env.example .env · seed (data-engine/run_pipeline.py) ·
#           pip install in data-engine + ml-service · (cd frontend && npm install && npm run build:css)
set -a; source .env; set +a

# three terminals:
( cd backend-api && mvn spring-boot:run )                                      # :8080
( cd ml-service  && source venv/bin/activate && uvicorn app:app --port 8000 )  # :8000
( cd frontend    && npm run serve )                                            # :5500
# → http://localhost:5500
```

> **OpenKBS** (`openkbs.json`, `functions/`, `site/`) is the dev playground only — nothing is
> deployed there. The whole stack runs on your machine.
