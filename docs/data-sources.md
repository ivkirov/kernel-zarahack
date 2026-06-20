# Data Sources & Method

The Time Poverty Matrix fuses three open datasets into a geocoded, per-settlement
**demand grid** (who needs services, and where) and a **supply layer** (where the
services actually are), then scores the travel-time gap between them. All processing is
offline and local; raw files live in `../datasets/` (gitignored). Dummy seed data has
been removed — the stack now runs on real data for all 28 Bulgarian provinces.

## Inputs (in `datasets/`)

| File | Role | Provider |
| :--- | :--- | :--- |
| `bulgaria-260618.osm.pbf` | **Supply** — kindergartens, schools, hospitals, clinics, pharmacies | Geofabrik / OpenStreetMap |
| `Население по области, възраст, местоживеене и пол.xlsx` | **Demand** — population by province × age × urban/rural (NSI, 31.12.2025) | NSI Infostat |
| `BG.zip` (→ `BG.txt`) | **Geocoding backbone** — every settlement's lat/lon, province & size | GeoNames |
| `geoBoundaries-BGR-ADM2_simplified.geojson` | Municipal borders — *available for an optional map overlay; not used by the current point-based frontend* | geoBoundaries |
| `gadm41_BGR_2.json.zip` | Fallback boundaries (unused) | GADM |

Full provenance/URLs: `datasets/DATASET_INFO.md`.

## Why a fusion was needed

The NSI workbook only resolves to **province + age band + urban/rural** — it has no
coordinates. GeoNames has the coordinates (7,239 settlements, each tagged with its
province `admin1` code and, for the ~355 largest, a population) but no age breakdown. We
combine them: NSI says *how many* children/seniors live in each province's towns vs.
villages; GeoNames says *where* those towns and villages are.

## Pipeline (`data-engine/`, run via `run_pipeline.py`)

1. **`00_create_schema.py`** — creates `infrastructure_nodes` (supply) and
   `demographic_weights` (demand).
2. **`01_extract_osm.py`** — scans the `.pbf` nationwide for the amenities in
   `config.AMENITY_MAP`, keeping nodes *and* building outlines (centroid). Each point is
   tagged with a province by its **nearest GeoNames settlement** (`geonames.assign_districts`).
3. **`02_extract_nsi.py`** — folds NSI age bands into our two cohorts, splits each by
   urban/rural, then distributes a province's cohort totals across that province's
   GeoNames settlements **weighted by settlement size**. Output preserves the official
   provincial totals while giving every settlement real coordinates.
4. **`03_seed_postgres.py`** — bulk-loads the two CSVs from `out/` into Postgres.

`geonames.py` is the shared loader used by steps 1 and 3.

## Key assumptions

- **Cohorts.** `children_0_6` = NSI ages `0` + `1-4` + ⅖ of `5-9` (uniform split of the
  5-year band to approximate ages 5–6); `seniors_65p` = sum of all bands `65-69 … 100+`.
- **Urban vs. rural.** A settlement is treated as *urban* (gets the NSI town age-share)
  if it is an administrative seat (`PPLC/PPLA/PPLA2/PPLA3`) or has population ≥ 2,000;
  otherwise *rural* (village age-share). See `config.URBAN_*`.
- **Village weighting.** ~6,900 small villages have no GeoNames population, so a
  province's rural cohort total is spread across them with a uniform relative weight
  (`VILLAGE_DEFAULT_WEIGHT`). Only the ratio matters — totals are normalized back to NSI.
- **Travel time** (in the backend): one-way minutes = `haversine_km / 4.5 km/h × 60`
  (a walking/local-mobility lower bound; `TPM_SPEED_KMH`).
- **Visit frequency:** `children_0_6` = 180 round-trips/yr, `seniors_65p` = 24/yr.

## Current snapshot

28 provinces · **2,772** supply nodes · **14,476** demand cells. Placed cohort totals
match NSI to ~0.1% (rounding). Pilot district **Pazardzhik** (frontend default): 52
nodes, 272 cells, ≈ **9.2M** wasted hours/year, worst access in remote Rhodope villages
(Barduche, Orlino, Sarnitsa) at 400+ minutes on foot — the education/healthcare deserts
the project targets.

## Run

```bash
cd data-engine
set -a; source ../.env; set +a            # PG* connection vars
./venv/bin/python run_pipeline.py         # 00 → 01 → 02 → 03  (~1.5 min, OSM scan dominates)
```
Seed one province instead of all 28: `TPM_NATIONWIDE=0 TPM_DISTRICT=Plovdiv ./venv/bin/python run_pipeline.py`.
