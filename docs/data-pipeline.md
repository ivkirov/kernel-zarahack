# Data Pipeline & Database Schema

The `data-engine/` is a one-time Python ETL that turns the raw `datasets/` files into the
PostgreSQL tables the backend reads. It is orchestrated by `run_pipeline.py`, which runs the
steps in order (`00 → 00b → 00c → 01 → 02 → 03`, ~1.5 min, the OSM scan dominates).

> **Schema vs. data.** Steps `00`, `00b`, `00c` are pure idempotent DDL
> (`CREATE … IF NOT EXISTS`); steps `01`–`03` extract + seed data (and need the raw
> datasets). The **auto-deploy** (`scripts/deploy.sh`) runs only the schema half, via
> **`migrate.py`** (`00 → 00b → 00c`), right before restarting the backend — so a commit
> that adds a table can't leave the live DB failing `ddl-auto: validate`. It never drops or
> seeds data, so it's a safe no-op on an already-migrated database.

## Pipeline steps

### `00_create_schema.py` — DDL
Creates `infrastructure_nodes` (supply) and `demographic_weights` (demand) with their
indexes and constraints. Idempotent (`CREATE TABLE IF NOT EXISTS`).

### `00b_create_auth_schema.py` — auth DDL
Creates the `app_users` table (accounts/roles/quota) the backend's auth layer needs.
Idempotent; kept separate from the geospatial schema since it's an app concern, not ETL.

### `00c_create_ai_cache_schema.py` — AI-cache DDL
Creates the `ai_explanation_cache` table (one cached AI write-up per spot + filters). Also an
app concern, also idempotent. The backend validates it at boot, so the deploy migration
ensures it exists.

### `01_extract_osm.py` — supply
Scans the `.pbf` nationwide with `pyosmium` for the amenities in `AMENITY_MAP`, keeping
both nodes *and* building outlines (centroid). Each point is tagged with a province by its
**nearest GeoNames settlement** (`geonames.assign_districts`). Writes a CSV to `out/`.

`AMENITY_MAP` normalizes OSM tags to our service types (note `doctors` collapses into
`clinic`):

```python
"kindergarten" → kindergarten (children_0_6)
"school"       → school       (children_0_6)
"hospital"     → hospital     (seniors_65p)
"clinic"       → clinic       (seniors_65p)
"doctors"      → clinic       (seniors_65p)
"pharmacy"     → pharmacy     (seniors_65p)
```

### `02_extract_nsi.py` — demand
Folds NSI age bands into the two cohorts, splits each province by urban/rural, then
distributes a province's cohort totals across that province's GeoNames settlements
**weighted by settlement size**. Output preserves the official provincial totals while
giving every settlement real coordinates. Writes a CSV to `out/`.

### `03_seed_postgres.py` — load
Bulk-loads the two CSVs from `out/` into PostgreSQL via `psycopg2.execute_values`.

`geonames.py` (`load_settlements`, `assign_districts`) is the shared GeoNames loader used by
steps 1 and 3.

## Run

```bash
cd data-engine
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
set -a; source ../.env; set +a            # PG* connection vars
python run_pipeline.py                     # 00 → 00b → 00c → 01 → 02 → 03 (all 28 provinces)
# schema only (no datasets needed) — what the auto-deploy runs:
python migrate.py                          # 00 → 00b → 00c, idempotent
```

Seed one province instead of all 28:

```bash
TPM_NATIONWIDE=0 TPM_DISTRICT=Plovdiv ./venv/bin/python run_pipeline.py
```

### Scope env vars

| Var | Default | Effect |
| :--- | :--- | :--- |
| `TPM_NATIONWIDE` | `1` | `1` = all 28 provinces; `0` = only `TPM_DISTRICT` |
| `TPM_DISTRICT` | `Stara Zagora` | the single province to seed when not nationwide |
| `TPM_SPEED_KMH` | `4.5` | walking-speed proxy used in time math |

## Database schema

The ETL produces exactly two tables. The backend runs JPA with `ddl-auto: validate`, so
these must exist and match the entity mappings before the API starts.

### `infrastructure_nodes` (supply)

```sql
CREATE TABLE infrastructure_nodes (
    id            BIGSERIAL PRIMARY KEY,
    osm_id        BIGINT,
    service_type  VARCHAR(32)      NOT NULL,   -- kindergarten|school|hospital|clinic|pharmacy
    amenity_raw   VARCHAR(64),                 -- original OSM amenity tag
    name          VARCHAR(256),
    lat           DOUBLE PRECISION NOT NULL,
    lon           DOUBLE PRECISION NOT NULL,
    district      VARCHAR(64)      NOT NULL,
    is_simulated  BOOLEAN          NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_nodes_type_district ON infrastructure_nodes (service_type, district);
```

### `demographic_weights` (demand)

```sql
CREATE TABLE demographic_weights (
    id          BIGSERIAL PRIMARY KEY,
    cell_id     VARCHAR(64)      NOT NULL,   -- settlement code or grid id
    settlement  VARCHAR(256),
    district    VARCHAR(64)      NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,   -- cell centroid
    lon         DOUBLE PRECISION NOT NULL,
    group_key   VARCHAR(32)      NOT NULL,   -- children_0_6 | seniors_65p
    population  INTEGER          NOT NULL,   -- persons in group in this cell
    UNIQUE (cell_id, group_key)
);
CREATE INDEX idx_weights_district_group ON demographic_weights (district, group_key);
```

The `UNIQUE (cell_id, group_key)` constraint means each settlement contributes at most one
row per cohort. The `(district, group_key)` index backs the backend's per-district,
per-group queries (`findByDistrict`).

### `app_users` (accounts)

Created by `00b_create_auth_schema.py` (also run by `run_pipeline.py`). The backend runs
`ddl-auto: validate`, so this table must exist before it boots; it then seeds the one admin.

```sql
CREATE TABLE app_users (
    id                BIGSERIAL PRIMARY KEY,
    email             VARCHAR(256) NOT NULL UNIQUE,
    password_hash     VARCHAR(512) NOT NULL,     -- pbkdf2$<iter>$<salt>$<hash>
    display_name      VARCHAR(128),
    role              VARCHAR(32)  NOT NULL,      -- ADMIN|FREE_USER|PAID_USER|REPORTER|MUNICIPALITY
    access_granted    BOOLEAN      NOT NULL DEFAULT FALSE,  -- paid access activated by an admin
    free_guesses_used INTEGER      NOT NULL DEFAULT 0,      -- free-tier usage counter
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

### `planned_municipal_projects` (Accountability Radar)

Owned by the AOP scraper (`aop_scraper_service.py`), not `run_pipeline.py`. The backend
reads it via JDBC and tolerates its absence (`available:false`) until the scraper's first
write. Key columns: `procurement_number` (UNIQUE dedup key), `buyer_name`, `project_name`,
`amenity_type`, `lat`, `lon`, `district`, `scraped_at`.

## How the backend consumes it

- `/matrix?district=X` → `nodeRepo.findByDistrict(X)` + `weightRepo.findByDistrict(X)`
  (or `findAll()` for the nationwide "all" view).
- `/simulate` → same district scope, restricted to the affected group.
- `/personal-compare` and `/personal-suggest` → `nodeRepo.findAll()` (no district in the payload).
- `/planned-projects` → JDBC read of `planned_municipal_projects` (Radar).

Data provenance and the fusion rationale: [datasets.md](datasets.md). The exact scoring
formulas: [methodology.md](methodology.md).
