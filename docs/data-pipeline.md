# Data Pipeline & Database Schema

The `data-engine/` is a one-time Python ETL that turns the raw `datasets/` files into two
PostgreSQL tables the backend reads. It is orchestrated by `run_pipeline.py`, which runs
four numbered steps in order (`00 → 01 → 02 → 03`, ~1.5 min, the OSM scan dominates).

## Pipeline steps

### `00_create_schema.py` — DDL
Creates `infrastructure_nodes` (supply) and `demographic_weights` (demand) with their
indexes and constraints. Idempotent (`CREATE TABLE IF NOT EXISTS`).

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
python run_pipeline.py                     # 00 → 01 → 02 → 03 (all 28 provinces)
```

Seed one province instead of all 28:

```bash
TPM_NATIONWIDE=0 TPM_DISTRICT=Plovdiv ./venv/bin/python run_pipeline.py
```

### Scope env vars

| Var | Default | Effect |
| :--- | :--- | :--- |
| `TPM_NATIONWIDE` | `1` | `1` = all 28 provinces; `0` = only `TPM_DISTRICT` |
| `TPM_DISTRICT` | `Pazardzhik` | the single province to seed when not nationwide |
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

## How the backend consumes it

- `/matrix?district=X` → `nodeRepo.findByDistrict(X)` + `weightRepo.findByDistrict(X)`
  (or `findAll()` for the nationwide "all" view).
- `/simulate` → same district scope, restricted to the affected group.
- `/personal-compare` → `nodeRepo.findAll()` (the personal payload carries no district).

Data provenance and the fusion rationale: [datasets.md](datasets.md). The exact scoring
formulas: [methodology.md](methodology.md).
