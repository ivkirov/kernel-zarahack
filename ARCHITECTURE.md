# Reclaim — How It Works

A complete technical reference for the project: what we built, the data behind it,
the machine-learning models, how they are trained, and how every service fits
together. This is the document to read (or hand to a judge) to prove we understand
our own system end to end.

---

## 1. The idea in one paragraph

**Time poverty** is the hidden tax a citizen pays when essential services
(kindergartens, schools, clinics, hospitals, pharmacies) are far from where they
live. A parent who drives 40 minutes each way to the nearest kindergarten loses
hundreds of hours a year. We quantify that loss in **annual wasted hours**, map it
across all 28 Bulgarian provinces, let municipalities **simulate** where a new
facility would return the most hours, let families **compare two addresses** by the
time cost of their real needs, and — through the **Accountability Radar** — we
cross-reference real planned public-procurement builds (scraped from `aop.bg`)
against the *mathematically optimal* locations our ML model recommends, flagging
spending that ignores demographic demand.

Three user-facing pillars:

| Pillar | Who | What it answers |
| --- | --- | --- |
| **Municipal mode** | City planners | "Where is time poverty worst, and where should we build to fix it?" |
| **Personal mode** | Families relocating | "Which of two addresses costs my household less travel time?" |
| **Accountability Radar** | Citizens / watchdogs | "Are the projects government is actually funding built in the right place?" |

---

## 2. System architecture

Four independent services, each doing one job, talking over HTTP/SQL:

```
                         ┌──────────────────────────────┐
                         │  Frontend (static, :5500)     │
                         │  Leaflet + Tailwind + GSAP    │
                         └──────┬───────────────┬────────┘
                                │ REST          │ REST
                                ▼               ▼
          ┌──────────────────────────┐   ┌──────────────────────────┐
          │ backend-api (Java, :8080)│   │ ml-service (Python, :8000)│
          │ Spring Boot 4 / Java 25  │   │ FastAPI + XGBoost/sklearn │
          │ matrix · simulate ·      │   │ recommend · traveltime    │
          │ personal-compare · radar │   │ (XGBoost surrogate)       │
          └───────────┬──────────────┘   └──────────────────────────┘
                      │ JDBC                       ▲ reads cached CSVs
                      ▼                            │ (same data as DB)
          ┌──────────────────────────┐            │
          │ PostgreSQL (:5434, Docker)│◄───────────┘
          │ infrastructure_nodes      │
          │ demographic_weights       │   ┌──────────────────────────┐
          │ planned_municipal_projects│◄──│ data-engine (Python ETL) │
          └──────────────────────────┘   │ OSM + NSI + GeoNames fuse │
                                          │ + aop.bg scraper service │
                                          └──────────────────────────┘
```

- **Frontend** is plain static files (no build framework). Tailwind CSS v3.4
  compiles to `dist/output.css`; Leaflet renders the map (canvas mode); GSAP drives
  animation; a small vanilla i18n layer does BG/EN.
- **backend-api** owns the deterministic "physics" math (haversine distance →
  travel minutes → wasted hours) and reads the seeded Postgres tables.
- **ml-service** owns the *learned* models: a travel-time regressor and an XGBoost
  placement-recommendation surrogate. It is intentionally **dataset-free at
  runtime** — it loads small cached CSVs so it can boot without Postgres.
- **data-engine** is the offline ETL that fuses the raw open datasets into Postgres,
  plus the live `aop.bg` procurement scraper that feeds the Radar.

Why split the math across Java *and* Python? The Java backend is the fast,
cacheable system of record for the deterministic matrix; the Python service is
where the ML lives (XGBoost, scikit-learn, numpy vectorization). They share the
exact same formula and constants so their numbers agree.

---

## 3. Datasets — what, why, and how we use them

All raw files live in `datasets/` (gitignored; documented in
`datasets/DATASET_INFO.md`). Everything is **real Bulgarian open data** — no
synthetic placeholders for the core supply/demand layers.

| File | Role | Source | How we use it |
| --- | --- | --- | --- |
| `bulgaria-260618.osm.pbf` (160 MB) | **Supply** | [Geofabrik / OpenStreetMap](https://download.geofabrik.de/europe/bulgaria-latest.osm.pbf) | Extract every `kindergarten`, `school`, `hospital`, `clinic`, `doctors`, `pharmacy` node/area → the facilities that *exist today*. ~2,800 nodes. |
| `Население по области, възраст, местоживеене и пол.xlsx` | **Demand** | [NSI Infostat](https://infostat.nsi.bg/infostat/pages/module.jsf?xid=1) (national statistics) | Official population by province × age band × urban/rural. We derive the two cohorts that actually drive trips: **children 0–6** and **seniors 65+**. |
| `BG.zip` → `BG.txt` | **Geocoding backbone** | [GeoNames](https://download.geonames.org/export/dump/BG.zip) | Every populated place with lat/lon + population + admin1 (province) code, plus Cyrillic alternate names. This is what turns province-level NSI totals into hundreds of point-located demand cells, and what geocodes scraped procurement towns offline. |
| `geoBoundaries-BGR-ADM2_simplified.geojson` | **Map boundaries** | [geoBoundaries](https://www.geoboundaries.org/) | Municipal borders + the country outline used for the geofence (point-in-country test, pan clamping). |
| `gadm41_BGR_2.json` | **Fallback boundaries** | [GADM](https://gadm.org/) | Backup admin-level-2 borders. |

### Why these three core sources

The whole model is a **supply-vs-demand spatial join**:

- **OSM = supply.** It is the most complete, current, openly licensed map of where
  facilities physically are.
- **NSI = demand magnitude.** It is the authoritative count of *how many* people in
  each cohort live in each province — the official Bulgarian census authority.
- **GeoNames = the spatial glue.** NSI gives counts per province but no
  coordinates; GeoNames gives coordinates + population per settlement. We use town
  population as the weight to **distribute** each province's NSI cohort total across
  its real towns, producing point-located demand instead of one dot per province.

### The province crosswalk (a subtle but important detail)

Three systems name provinces three different ways: NSI uses Cyrillic
(`Пловдив`), GeoNames uses numeric admin1 codes (`51`), the app uses Latin
(`Plovdiv`). A single authoritative dict (`data-engine/config.py` `PROVINCES`,
mirrored in `ml-service/dataload.py`) ties all three together. This correctly
separates the two Sofias — **София (столица)** = admin1 `42` (the capital city) vs
**София** = `58` (the surrounding province) — which a naive name match would merge.

---

## 4. The data engine (ETL)

`data-engine/run_pipeline.py` runs four ordered steps:

1. `00_create_schema.py` — create the Postgres tables (Python owns the schema).
2. `01_extract_osm.py` — parse the `.osm.pbf` with `osmium`, keep mapped amenities,
   normalize to `service_type`, dedupe → `infrastructure_nodes`.
3. `02_extract_nsi.py` — parse the NSI Excel, fold age bands into the two cohorts,
   distribute across GeoNames settlements → `demographic_weights`.
4. `03_seed_postgres.py` — write both tables.

### Cohort definition (how age bands map to cohorts)

NSI publishes 5-year bands. The exact rule (`config.py`):

- **children_0_6** = all of band `"0"` + all of `"1 - 4"` + **2/5 of `"5 - 9"`**
  (ages 5 and 6, assuming a uniform spread of single years inside the band).
- **seniors_65p** = every band from `65 - 69` through `100 +`.

These two cohorts are chosen because they generate the most *recurring, mandatory*
trips: small children → daily kindergarten/school runs; seniors → clinics,
hospitals, pharmacies. That recurrence is what converts distance into large annual
hour losses.

### Schema (the two core tables)

```
infrastructure_nodes(osm_id, service_type, name, lat, lon, district)
demographic_weights (cell_id, settlement, district, lat, lon, group_key, population)
planned_municipal_projects(procurement_number, buyer_name, project_name,
                           amenity_type, lat, lon, district, scraped_at)
```

The Java backend runs `ddl-auto: validate` — it never mutates the schema; the
Python engine is the single owner. The ML service can read the **same data** from
cached CSVs (`models/_weights_cache.csv`, `models/_nodes_cache.csv`) so it boots
without a database.

---

## 5. The core formula (deterministic, shared everywhere)

Every pillar reduces to the same chain. For one demand cell:

```
distance_km   = haversine(cell, nearest_serving_facility)
one_way_min   = travel_time(distance_km)             # constant proxy (Java) or learned (ML)
annual_hours  = one_way_min × 2 (round trip) × visits_per_year × population ÷ 60
```

- **Round trip** → `× 2`.
- **visits_per_year** is cohort/amenity specific. Defaults (`application.yml`,
  `sim.py`): children_0_6 = 180 round trips/yr, seniors_65p = 24. The fine-grained
  personal planner uses per-amenity cadences (kindergarten/school ≈ 380,
  pharmacy 30, clinic 18, hospital 6).
- **time_poverty_score** for the heat layer = `one_way_min × population` (the raw
  "person-minutes of distance" a cell suffers).
- **System total** = sum of `annual_hours` over all cells = the province's (or
  country's) total wasted hours.

The Java backend computes the deterministic version with a flat
`assumed-speed-kmh: 4.5` proxy for the live matrix (fast, cacheable). The ML
service replaces that flat proxy with a **learned travel-time curve** for its
placement scoring.

---

## 6. The machine-learning models

Two models live in `ml-service/models/`, both trained offline against the real OSM
geography + NSI×GeoNames demand, served by FastAPI.

### 6.1 Travel-time model (`traveltime.pkl`)

**Purpose.** Replace the naïve "distance ÷ constant speed" with a learned curve so
urban trips (denser roads) are faster than rural ones.

- **Algorithm:** `HistGradientBoostingRegressor` (scikit-learn) — gradient-boosted
  trees, fast and robust on small tabular data.
- **Features (3):** `haversine_km`, `is_urban` (within 15 km of a province centre),
  `dest_density` (number of facilities within 5 km of the destination).
- **Target:** travel minutes.
- **Labels — two modes:**
  - *Real:* if `ORS_API_KEY` is set, query OpenRouteService for ~800 origin–
    destination driving routes across a Bulgaria-wide bounding box.
  - *Synthetic (default):* a physics-based speed curve — 42 km/h urban, 24 km/h
    rural — with realistic ±15–25 % noise. It is still a *learned curve*, never a
    single hardcoded constant.
- **Two correctness guarantees baked into training:**
  - **Monotonic constraint** `monotonic_cst=[1,0,0]` forces predicted time to be
    non-decreasing in distance (a tree model otherwise can wiggle). A dense sweep
    self-check counts monotonicity violations after training.
  - **Zero-anchors:** 60 explicit near-zero-distance samples pin "a service next
    door ≈ 0 min", fixing the classic tree artifact where km=0 predicts ~8 min.
- **Hyperparameters:** `max_iter=400, max_depth=3, learning_rate=0.05`.
- Reported at train time: MAE (minutes), R², monotonic violations, km=0 prediction.

### 6.2 Placement model (`placement_children_0_6.pkl`, `placement_seniors_65p.pkl`)

This is the **XGBoost** model that powers both the municipal "recommend best sites"
feature and the Radar's optimal-location audit.

**The problem it solves.** "If we build one new facility at location *X*, how many
annual hours does the whole region save?" The honest way to answer is to run the
full simulation for *X*: recompute every cell's nearest-facility time assuming *X*
exists, and sum the savings. That is expensive to do for thousands of candidate
locations in real time. So we train a **surrogate model** that learns the
simulation's output from cheap location features, then scores thousands of
candidates instantly.

**How training labels are generated (this is the key trick).**

1. Lay a **44×44 grid** (1,936 candidate sites) over Bulgaria's bounding box.
2. For **each** candidate, run the *real vectorized simulation* (`sim.hours_saved`):
   compute the learned travel time from that candidate to every demand cell, take
   `min(current_time, new_time)` per cell, and sum the annual hours saved. That sum
   is the **ground-truth label**.
3. Drop empty sea/border cells (`demand_15km > 0`).

So the labels are not invented — they are produced by actually simulating the
intervention at every grid point.

**Features (6), deliberately location-free and baseline-aware** (`sim.py`
`PLACEMENT_FEATURES`):

| Feature | Meaning |
| --- | --- |
| `demand_5km` | cohort population within 5 km |
| `demand_15km` | cohort population within 15 km |
| `dist_nearest_service_km` | distance to the closest existing facility |
| `addressable_hours_10km` | currently-wasted annual hours within 10 km |
| `addressable_hours_25km` | currently-wasted annual hours within 25 km |
| `mean_baseline_min_15km` | population-weighted current travel time within 15 km |

Raw lat/lon are **excluded on purpose** — we want the model to generalize from the
*situation* around a point (how much unmet, addressable demand surrounds it), not
memorize coordinates. The strongest signal is "how much time poverty is reachable
from here."

- **Algorithm:** `XGBRegressor` (gradient-boosted trees), with a graceful fallback
  to sklearn `GradientBoostingRegressor` if XGBoost is unavailable.
- **Hyperparameters:** `n_estimators=600, max_depth=4, learning_rate=0.04,
  subsample=0.9, colsample_bytree=0.9, reg_lambda=2.0, min_child_weight=3`.
- **Split:** 80/20 train/test, `random_state=42`. Reports MAE (hours) and R².
- **Per-cohort models:** one for `children_0_6`, one for `seniors_65p`, because the
  serving facilities and visit frequencies differ. `placement.pkl` is the last-
  trained default.

### 6.3 Serving the recommendation — `GET /api/ml/recommend`

`?amenity=&district=&top=3`. Pipeline:

1. Build a candidate grid over the country, or just the requested province's bbox.
2. Skip candidates with zero population within 15 km.
3. Compute the 6 features per candidate and predict hours-saved with the cohort's
   XGBoost model.
4. Sort descending, then apply **greedy non-maximum suppression**
   (`min_separation_km = 8`) so the top-N aren't all the same town.
5. Return each pick's lat/lon, nearest town, and predicted annual hours saved.

---

## 7. The three pillars (API surface)

backend-api base: `http://localhost:8080/api/v1/time-poverty`. **Every endpoint below
requires a JWT** (`Authorization: Bearer`, from `/api/v1/auth/login|register`) and is gated
by role — see §7.4. Each pillar maps to a paid tier.

### Pillar 1 — Municipal mode

- `GET /matrix?district=` → every facility node + every demand cell with its
  `nearestMinutes`, `timePovertyScore`, `annualWastedHours`, plus the system total.
  `@Cacheable("matrix")` keyed by district (the nationwide view is ~14k cells ×
  ~2.8k nodes, so caching makes province switches instant).
- `POST /simulate` → drop a hypothetical facility at (lat,lon); returns per-cell
  before/after minutes, people impacted, and total annual hours saved.
- The map also calls `GET /api/ml/recommend` to overlay the **XGBoost-optimal**
  build sites.

### Pillar 2 — Personal mode

- `POST /personal-compare` → two addresses (current vs prospective) + a household
  profile (a list of real `needs`: kindergarten, school, clinic, hospital,
  pharmacy). Returns a per-need weekly-hours breakdown for both addresses and the
  net **efficiency shift** (hours returned to the family by moving). Per-need visit
  cadences make the comparison reflect how often the household actually travels to
  each service.

### Pillar 3 — Accountability Radar

- `GET /planned-projects` → the cached, geocoded `aop.bg` builds (tolerates a
  missing table → `available:false`).
- For each project the frontend calls `mlOptimalSites(district, amenity)` and
  **cross-references** the project's location against the model's optimal sites,
  computing the distance to the nearest optimum. A project far from where demand
  says it should be gets a warning flag on the map.

**The procurement scraper** (`data-engine/aop_scraper_service.py`) is a scheduled
service (APScheduler, every two weeks + an immediate run on startup) that hits the
**real legacy aop.bg registry**:

1. Quick-search `ssearch.php?mode=search&word=<TERM>` — the portal predates UTF-8,
   so the term is **Windows-1251** encoded and responses decoded the same way.
   Results are vertical `label:value` blocks of `<tr class="odd|even">`.
2. Detail page `ng/form.php?id=<ID>` → buyer ("Официално наименование") and build
   location ("Основно място на изпълнение: гр. X").
3. **Offline geocode** the build town against the local GeoNames gazetteer (incl.
   Cyrillic alternate names) → lat/lon + Latin province for the ML audit. No
   external geocoder, so it works air-gapped.
4. Dedupe and upsert into `planned_municipal_projects`.

### The size-relative audit (Radar correctness)

A flat "X km from optimal = misaligned" threshold is wrong: 30 km is nothing in a
large rural province and huge in a compact one. So the verdict scale **depends on
province size**. We compute a **characteristic radius** per province = the
90th-percentile distance of its settlements from the province centroid, clamped to
[10, 35] km (`provinceScaleKm`). Then (`verdictFor`):

| Distance to nearest optimal site | Verdict |
| --- | --- |
| ≤ 0.30 × radius | **good** ✓ |
| ≤ 0.70 × radius | **review** ! |
| ≤ 1.0 × radius | **flag** ⚑ |
| > radius | **far** ∞ (optimal is simply elsewhere in the region — neutral, not a flag) |

This fixed a real false positive where a Plovdiv kindergarten 65 km from the
province-wide optimum was being labelled "misaligned" — it now correctly reads as
*the optimum is in a different part of the province*, not a misallocation.

### 7.4. Accounts, roles & paid tiers

The app is fronted by accounts and usage-based gating. Auth is **dependency-free** (no
Spring Security / JWT libraries, so the build stays offline on Spring Boot 4.1 / Java 25):
PBKDF2-HMAC-SHA256 password hashing, a hand-rolled HS256 JWT (`JwtUtil`), and a servlet
`AuthFilter` that loads the caller into a per-request `CurrentUser`. The whole policy lives
in `security/Features`.

| Role | Tier | Gets |
| --- | --- | --- |
| `FREE_USER` | free | Personal mode, **3** relocation checks, filters limited to school/clinic/hospital/pharmacy; no AI explanation |
| `PAID_USER` | 1 | Personal mode unlimited + AI explanation (`/personal-compare`) + area suggestions (`/personal-suggest`) + all filters |
| `REPORTER` | 2 | Accountability Radar (`/planned-projects`) |
| `MUNICIPALITY` | 3 | Municipal mode (`/matrix`, `/simulate`) |
| `ADMIN` | — | every lens + user management; one account, seeded from config |

At signup a persona picks the role (which can **only** be a non-admin role — promotion to
`ADMIN` is rejected by the admin API, not just hidden in the UI). Reporter/municipality land
**locked** until access is activated — either an admin grants it, or the account self-serves
via `POST /api/v1/auth/activate` (a stand-in for a real checkout: it activates the caller's
own paid access but can never reach `ADMIN`). Admin email/password and the JWT key come from
the environment (`APP_ADMIN_*`, `APP_AUTH_JWT_SECRET`) — never hardcoded; see
[SECURITY.md](SECURITY.md). Endpoints return
`{code, message}` on auth/quota failures (`UNAUTHENTICATED`, `ACCESS_*`, `PAYWALL_*`) which
the frontend turns into login/paywall modals. New tables: `app_users` (auth) and admin
endpoints `GET/PATCH /api/v1/admin/users`. The AI explanation is currently a templated
`ExplanationService` (a deterministic narrative) with a clean seam to swap in an LLM call.

---

## 8. Frontend

- **Stack:** static HTML + vanilla JS, Tailwind CSS v3.4 (compiled to
  `dist/output.css` via `npm run build:css`), Leaflet.js in canvas mode
  (`preferCanvas`), GSAP 3.12.5 for staggered entrance/animation, served by
  `live-server` on `:5500`.
- **i18n:** a tiny vanilla layer (`window.I18n` / `window.t`) with BG (default) and
  EN locales, `data-i18n*` attributes, and live re-render on switch.
- **Map UX hardening:**
  - **Caching:** the matrix is cached client-side for 30 min per district
    (`MATRIX_CACHE_TTL`) on top of the server-side cache.
  - **Layer filters:** each service type is a toggleable layer; pharmacies (~1,620
    nodes, the densest set) are municipal-hidden by default to keep the first view
    readable, and are personal-mode only.
  - **Geofence:** a ray-casting point-in-country test against the country outline
    blocks clicks outside Bulgaria ("We currently only have data for Bulgaria"),
    and `maxBounds` + viscosity + `minZoom` clamp panning back to the country.
- **Auth & role-aware UI** (`frontend/src/auth.js`): a login/register gate, `Auth.apiFetch`
  (adds the bearer header, centralises 401/paywall handling), the paywall modal and the
  admin user-management panel. `app.js` shows only the lens cards the role allows and an
  admin-only demo paid/free toggle to preview the free experience.
- **Config** (`frontend/src/config.js`): API/ML/auth/admin base URLs, per-service colours
  and metadata, personal needs, free-allowed amenities, Bulgaria bounds, cache TTL.

---

## 9. How to run it locally

```bash
# 1. Postgres (Docker)
docker start tpm-postgres            # exposes :5434

# 2. Seed the database (one-time / on data refresh)
cd data-engine && set -a; source ../.env; set +a
./venv/bin/python run_pipeline.py

# 3. (optional) retrain models
cd ../ml-service
./venv/bin/python train_traveltime.py
PLACE_AMENITY=kindergarten ./venv/bin/python train_placement.py   # children
PLACE_AMENITY=hospital     ./venv/bin/python train_placement.py   # seniors

# 4. ML service
./venv/bin/uvicorn app:app --port 8000

# 5. Backend
cd ../backend-api && ./mvnw spring-boot:run     # :8080

# 6. Frontend
cd ../frontend && npm run build:css && npx live-server --port=5500

# 7. (optional) live procurement scraper for the Radar
cd ../data-engine && set -a; source ../.env; set +a
./venv/bin/python aop_scraper_service.py
```

Open `:5500` and **sign in**. The backend seeds one admin on first start, using
`APP_ADMIN_EMAIL` / `APP_ADMIN_PASSWORD` from the environment (the local `.env` ships
`admin@gmail.com` / `P4$$w0rd!` for dev convenience; if the password is unset the backend
generates a random one and logs it once). That admin can use every lens and grant paid
access from the user-management panel. **Production must set its own** `APP_ADMIN_PASSWORD`
and a strong `APP_AUTH_JWT_SECRET` — see [SECURITY.md](SECURITY.md).

---

## 10. Honest limitations (so we can defend, not oversell)

- **Travel time** is a learned curve, but unless `ORS_API_KEY` is set the labels are
  physics-synthetic, not real routed times. The architecture swaps in real ORS
  labels with one env var.
- **Demand distribution** uses town population as a proxy to spread province cohort
  totals; it assumes cohort share is roughly uniform within a province.
- **Placement model is a surrogate** of the simulation — it trades a small accuracy
  loss (reported MAE/R²) for the ability to score thousands of candidates instantly.
- **The OSM extract** is only as complete as OSM tagging; a handful of facilities
  may be missing or mistagged.
- **Procurement geocoding** resolves to the build town's coordinates; very granular
  intra-city placement isn't distinguished, and some records (e.g. ambiguous Sofia
  quarters) may remain ungeocoded.

These are deliberate, documented trade-offs — every one has a clear upgrade path.
```