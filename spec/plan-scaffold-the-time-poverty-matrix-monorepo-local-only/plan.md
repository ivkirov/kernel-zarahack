# Plan — Scaffold "The Time Poverty Matrix" monorepo (local-only)

## Context

We're building a hackathon project, **The Time Poverty Matrix**, from the blueprint in
`.uploads/16bfca6e_JUMPSTART.md`. It quantifies the invisible "time tax" that infrastructure
gaps impose on vulnerable populations (children 0–6, seniors 65+) around Pazardzhik, Bulgaria,
and renders it on an interactive map with a click-to-simulate "what-if" ROI engine.

Three subsystems live in **one repo**, all running **locally**:
- `backend-api/` — Java 21 / Spring Boot 3.3.2 / JPA REST server on `localhost:8080`
- `data-engine/` — Python 3.11 ETL + seeding against a **local** PostgreSQL on `localhost:5432`
- `frontend/` — Tailwind CSS + Leaflet.js dark dashboard on `localhost:5500`

**Hard constraints (from the upload):**
- OpenKBS is a code-generation playground **only**. Generate **no** Dockerfiles, serverless
  functions, cloud manifests, or deployment config. Everything runs locally.
- Database is a standard local PostgreSQL; all creds come from env vars
  (`PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD/PGSSLMODE`).
- Real datasets (`bulgaria-latest.osm.pbf`, NSI Excel) are not yet available, so we build and
  test the whole stack against **dummy data** first via a new `99_seed_dummy.py`.
- Existing OpenKBS scaffolding (`openkbs.json`, `functions/`, `site/`) is **left untouched** —
  the new subsystems are added beside it.
- Package name `com.zarahack.timepoverty` and all paths exactly per the blueprint.
- Files must be **complete and runnable** — no placeholders or TODO stubs.

## Execution model — STOP after each numbered step

The upload requires: *"do these in sequence, stop after each so I can review."* After plan
approval I will implement **one step at a time**, and after each step **pause** and hand back the
exact terminal commands to run/verify it (curl / browser), then wait for the go-ahead before the
next step. The six steps below are the review gates.

Almost all file contents are given verbatim in the blueprint; I'll reproduce them faithfully.
The one genuinely new file is `99_seed_dummy.py` (designed below).

---

## Step 1 — Project scaffolding (all three subsystems)

Create directory trees and config files:

- **Root**
  - `.env.example` — blueprint §2 (local Postgres creds template).
  - Merge into existing root `.gitignore`: add the blueprint's ignores
    (`data-engine/raw/*.pbf|*.xlsx`, `data-engine/out/*.csv`, `backend-api/target/`,
    `**/venv/`, `**/__pycache__/`, `*.pyc`, `frontend/node_modules/`, `frontend/dist/output.css`)
    **and** add `!.env.example` so the template is committable despite the existing `.*` rule.
    Keep the existing OpenKBS-oriented lines.
- **backend-api/** — `pom.xml` (Spring Boot 3.3.2, Java 21; deps: web, data-jpa, postgresql,
  test). `mvnw`/`mvnw.cmd` generated via `mvn -N wrapper:wrapper` **if** `mvn` is present;
  otherwise documented `mvn spring-boot:run` fallback.
- **data-engine/** — `requirements.txt` (osmium, pandas, openpyxl, psycopg2-binary,
  python-dotenv, tqdm), `.python-version` (`3.11`).
- **frontend/** — `package.json` (tailwindcss, live-server), `tailwind.config.js`,
  `postcss.config.js`.
- **docs/** — `docs/data-sources.md` (provenance notes).

**Verify:** `find backend-api data-engine frontend docs -type f` shows the scaffold; `pom.xml`
parses (`mvn -q -f backend-api/pom.xml validate` if mvn present).

## Step 2 — Python schema layer

- `data-engine/config.py` — blueprint §3.2 verbatim (districts/bbox, `AMENITY_MAP`,
  `ASSUMED_SPEED_KMH`, `VISITS_PER_YEAR`, `pg_dsn()`).
- `data-engine/00_create_schema.py` — blueprint §3.3 verbatim (DDL for `infrastructure_nodes`
  + `demographic_weights`, indexes, unique constraints).

**Verify:** with `.env` + local Postgres, `python 00_create_schema.py` then `psql … -c '\dt'`
lists both tables.

## Step 3 — NEW dummy seeder (`data-engine/99_seed_dummy.py`)

New script (not in blueprint) to exercise the full stack before real data lands. Same
`config.pg_dsn()` + `psycopg2.extras.execute_values` pattern as `03_seed_postgres.py`.

- District `"Pazardzhik"`. Synthetic `osm_id`s (e.g. negative/sequential), `is_simulated=False`.
- **~20 `infrastructure_nodes`** across `kindergarten`, `school`, `hospital`, `clinic`,
  **scattered** (lat ~42.0–42.3, lon ~24.0–24.5) with realistic Bulgarian names — deliberately
  scattered (not clustered) so the map and simulation deltas are visible.
- **~30 `demographic_weights`** rows split across `children_0_6` and `seniors_65p`, scattered
  over the same bbox with plausible populations (children ~20–400, seniors ~30–600). Unique
  `cell_id` per settlement (`children_0_6` + `seniors_65p` share a `cell_id`, satisfying the
  `(cell_id, group_key)` unique constraint).
- `TRUNCATE … RESTART IDENTITY` both tables, then bulk insert. Print row counts.

**Verify:** `python 99_seed_dummy.py` prints counts; `psql … -c 'SELECT service_type,count(*)
FROM infrastructure_nodes GROUP BY 1;'` and a `demographic_weights` group-by show the rows.

## Step 4 — Java Spring Boot backend

All files verbatim from blueprint §4 under `com.zarahack.timepoverty`:
- `TimePovertyApplication.java` (entrypoint — implied by blueprint, standard
  `@SpringBootApplication`).
- `config/CorsConfig.java`; `resources/application.yml` (env-driven datasource,
  `ddl-auto: validate`, `app.geo.assumed-speed-kmh`, `app.visits-per-year.*`).
- `entity/InfrastructureNode.java`, `entity/DemographicWeight.java`.
- `repository/InfrastructureNodeRepository.java`, `repository/DemographicWeightRepository.java`.
- `service/GeoUtil.java` (Haversine + travel-time proxy), `service/TimePovertyService.java`
  (baseline scoring + simulation — formulas from §1 exactly).
- `dto/MatrixResponse.java`, `dto/SimulationRequest.java`, `dto/SimulationResponse.java`.
- `controller/TimePovertyController.java` (`GET /matrix`, `POST /simulate`).
- `test/…/GeoUtilTest.java` (Haversine sanity test).

**Verify (with dummy data seeded + `PG*` exported):** `mvn -f backend-api spring-boot:run`, then
`curl "http://localhost:8080/api/v1/time-poverty/matrix?district=Pazardzhik"` returns
`totalAnnualWastedHours` + populated `nodes`/`cells`; the §4.8 sample `POST /simulate` curl
returns `annualWastedHoursSaved` and `deltas`.

## Step 5 — Frontend dashboard

Verbatim from blueprint §5:
- `frontend/index.html` (dark grid: Leaflet map + amenity `<select>`, metric cards, HUD).
- `frontend/src/input.css` (Tailwind directives + `.metric-card` component layer).
- `frontend/src/config.js` (`API_BASE_URL`, Pazardzhik center/zoom, color ramps).
- `frontend/src/app.js` (Leaflet init, `loadMatrix()`, `map.on('click')` → `POST /simulate`,
  `animateCounter` HUD, `povertyColor` choropleth).
- `tailwind.config.js` confirmed from Step 1 (dark palette, content globs).

**Verify:** `npm install`; `npm run build:css` (writes `dist/output.css`); `npm run serve`; open
`http://localhost:5500` — map renders over Pazardzhik, baseline counter animates, clicking the
map animates the "Hours Saved" HUD and shades improved cells green. (I'll note explicitly if I
can't drive a real browser in this environment.)

## Step 6 — Real extractors (complete, but won't fully run until raw files arrive)

Verbatim from blueprint §3:
- `data-engine/01_extract_osm.py` (pyosmium `AmenityHandler` → CSV).
- `data-engine/02_extract_nsi.py` (pandas/openpyxl district slice → weights CSV).
- `data-engine/03_seed_postgres.py` (psycopg2 bulk load of the two CSVs).
- `data-engine/run_pipeline.py` (orchestrates `00→01→02→03`).

**Verify:** `python -c "import ast; ast.parse(open(f).read())"` for each (syntax OK).
`run_pipeline.py` / `01` / `02` need the raw `.pbf` + NSI Excel to fully run — documented as the
post-data step; `03` works once CSVs exist.

---

## Files to create (summary)

```
.env.example                                   (Step 1)
.gitignore                                     (Step 1 — merge)
docs/data-sources.md                           (Step 1)
backend-api/pom.xml  (+ mvnw* if mvn present)  (Step 1)
data-engine/requirements.txt, .python-version  (Step 1)
frontend/package.json, tailwind.config.js, postcss.config.js  (Step 1)
data-engine/config.py, 00_create_schema.py     (Step 2)
data-engine/99_seed_dummy.py                   (Step 3 — NEW)
backend-api/src/main/java/com/zarahack/timepoverty/**.java
backend-api/src/main/resources/application.yml
backend-api/src/test/java/com/zarahack/timepoverty/GeoUtilTest.java   (Step 4)
frontend/index.html, src/input.css, src/app.js, src/config.js         (Step 5)
data-engine/01_extract_osm.py, 02_extract_nsi.py,
data-engine/03_seed_postgres.py, run_pipeline.py                      (Step 6)
```

Untouched: `openkbs.json`, `functions/`, `site/`, `.claude/`.

## End-to-end verification (after all steps, once dummy-seeded)

1. Local Postgres up; `.env` filled; `set -a; source .env; set +a`.
2. `cd data-engine && python 00_create_schema.py && python 99_seed_dummy.py`.
3. `cd backend-api && mvn spring-boot:run`; curl the matrix + simulate endpoints.
4. `cd frontend && npm install && npm run build:css && npm run serve`; exercise map +
   click-to-simulate at `http://localhost:5500`.
