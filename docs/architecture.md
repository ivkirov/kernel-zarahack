# Architecture

Everything runs **locally** on one machine. There are four code subsystems plus a
PostgreSQL database; the OpenKBS files (`openkbs.json`, `functions/`, `site/`) are a
code-generation playground only and are never deployed.

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

## Components

| Component | Tech | Port | Role |
| :--- | :--- | :--- | :--- |
| `backend-api/` | Java 25 · Spring Boot 4.1.0 · JPA | **8080** | matrix / simulate / personal REST API + accounts/roles/JWT auth |
| `ml-service/` | Python 3 · FastAPI · scikit-learn / XGBoost | **8000** | trained AI bots: placement recommender + travel-time model |
| `frontend/` | Tailwind CSS · Leaflet.js | **5500** | dark dashboard + map; login gate + role-aware lenses |
| `data-engine/` | Python · pyosmium · pandas | — | one-time ETL that seeds PostgreSQL from `datasets/` (+ AOP scraper) |
| PostgreSQL | local | **5432** | `infrastructure_nodes` · `demographic_weights` · `app_users` · `planned_municipal_projects` |

Java package root: `com.zarahack.timepoverty`.

## Request flows

### Municipal mode — baseline + simulate
1. Frontend `loadMatrix()` → `GET /api/v1/time-poverty/matrix?district=<name>`.
2. Backend reads nodes + weights for the district from PostgreSQL, computes every cell's
   nearest-service minutes and annual wasted hours, returns nodes (markers) and cells
   (choropleth) plus the systemic total. The result is cached per district (`@Cacheable`).
3. User clicks the map → `POST /simulate` with a candidate lat/lon + amenity type. Backend
   recomputes per-cell minutes against the hypothetical new node and returns the annual
   hours saved, people impacted, and per-cell deltas.

### Municipal mode — AI recommend
- **AI: Recommend best sites** → `GET :8000/api/ml/recommend?amenity=&district=&top=3`.
- The ML service sweeps a candidate grid, scores each with the placement model, applies
  greedy non-maximum suppression, and returns ranked sites. It runs entirely from a cached
  model bundle (`ml-service/models/`) — **no PostgreSQL, no datasets** at runtime.

### Personal mode
- Two pins → `POST /api/v1/time-poverty/personal-compare` with the household profile.
  Backend evaluates each home against `nodeRepo.findAll()` (the personal payload carries no
  district) and returns weekly time-tax per residence plus the efficiency shift.

## Why two backends

The Java service owns the **authoritative, DB-backed** matrix math used by both modes. The
Python service exists because the **AI models** are Python-native (scikit-learn / XGBoost)
and are intentionally decoupled: they ship as a committed `.pkl` bundle and serve
recommendations even when the database has not been seeded — useful for demos and for
distributing the models between machines (see [ml-service.md](ml-service.md)).

## Auth, roles & tiers

Every `/api/v1/time-poverty/*` and `/api/v1/admin/*` call requires a JWT
(`Authorization: Bearer`). Auth is dependency-free (PBKDF2 + hand-rolled HS256 JWT + a
servlet filter — no Spring Security). Five roles map to the paid tiers — `PAID_USER` (t1),
`REPORTER` (t2), `MUNICIPALITY` (t3) — with `FREE_USER` (limited) and one hardcoded `ADMIN`.
Reporter/municipality sign-ups are locked until an admin grants access (payments are
admin-assigned). Details: [backend-api.md](backend-api.md) · [api-reference.md](api-reference.md).

## Cross-cutting config

- **CORS** — both services explicitly allow `http://localhost:5500` and
  `http://127.0.0.1:5500`. The backend `CorsConfig` permits GET/POST/PUT/PATCH/DELETE/OPTIONS
  and all headers (for the `Authorization` bearer) on `/api/**`.
- **Connection** — the backend reads `PG*` environment variables (Hikari pool, max 5
  connections) and runs JPA with `ddl-auto: validate`, so the schema must already exist
  (seeded by `data-engine`).
- **Tunables** — assumed walking speed (4.5 km/h) and annual visit counts live in the
  backend `application.yml`; the ETL mirrors them in `data-engine/config.py`. See
  [methodology.md](methodology.md).

## Repository map

```
kernel-zarahack/
├── README.md                ← concise entry point → links here
├── docs/                    ← this documentation set
├── .env.example             # local Postgres credentials template
├── datasets/                # raw OSM / NSI / GeoNames (gitignored)
├── backend-api/             # Java Spring Boot REST API (:8080)
├── data-engine/             # Python ETL → seeds Postgres (run once)
├── ml-service/              # Python AI sidecar (:8000) — placement + travel-time
│   ├── models/              #   trained .pkl bundle + cached features (committed)
│   ├── README.md · INTEGRATION.md
├── frontend/                # Tailwind + Leaflet SPA (:5500)
└── spec/                    # build plans (municipal + dual-mode framework)
```
