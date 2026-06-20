# Datasets & Data Fusion

The Time Poverty Matrix fuses three open datasets into a geocoded, per-settlement
**demand grid** (who needs services, and where) and a **supply layer** (where the services
actually are), then scores the travel-time gap between them. All processing is offline and
local; raw files live in `datasets/` (gitignored). The stack runs on **real data for all
28 Bulgarian provinces** — no dummy seed data.

## Inputs (in `datasets/`)

| File | Role | Provider |
| :--- | :--- | :--- |
| `bulgaria-260618.osm.pbf` | **Supply** — kindergartens, schools, hospitals, clinics, pharmacies | Geofabrik / OpenStreetMap |
| `Население по области, възраст, местоживеене и пол.xlsx` | **Demand** — population by province × age × urban/rural (NSI, 31.12.2025) | NSI Infostat |
| `BG.zip` (→ `BG.txt`) | **Geocoding backbone** — every settlement's lat/lon, province & size | GeoNames |
| `geoBoundaries-BGR-ADM2_simplified.geojson` | Municipal borders — optional map overlay; not used by the current point-based frontend | geoBoundaries |
| `gadm41_BGR_2.json.zip` | Fallback boundaries (unused) | GADM |

Full provenance/URLs: `datasets/DATASET_INFO.md`.

## Why a fusion was needed

The three datasets each hold one piece of the puzzle and none holds all of it:

- **NSI** has the *demographics* — population by **province + age band + urban/rural** — but
  **no coordinates**. It can tell you how many children or seniors live in a province's
  towns vs. its villages, but not where those towns are.
- **GeoNames** has the *geography* — 7,239 settlements, each tagged with its province
  (`admin1` code) and, for the ~355 largest, a population — but **no age breakdown**.
- **OSM** has the *supply* — the actual facility locations — but nothing about demand.

The fusion combines them: NSI says *how many* children/seniors live in each province's
towns vs. villages; GeoNames says *where* those towns and villages are; OSM says *where the
services already exist*. The result is a per-settlement demand grid with real coordinates
that still reconciles to the official NSI provincial totals.

```
NSI Excel (age × province) ─┐
GeoNames BG.txt (towns+pop) ─┼─▶ located settlement demand points (children_0_6, seniors_65p)
OSM .pbf (2,772 services)  ──┴─▶ supply nodes
```

## The province crosswalk

The three sources name provinces three different ways, so a crosswalk ties them together
(`PROVINCES` in `data-engine/config.py`): NSI labels rows in **Cyrillic**, GeoNames tags
settlements with an **admin1 code**, and the frontend speaks the **Latin** name. The dict
maps Cyrillic → (admin1 code, Latin name) for all 28 *oblasti*, e.g.
`"Пазарджик" → ("48", "Pazardzhik")`.

## Key assumptions

- **Cohorts.** `children_0_6` = NSI ages `0` + `1-4` + ⅖ of `5-9`; `seniors_65p` = sum of
  all bands `65-69 … 100+`. (Full math in [methodology.md](methodology.md).)
- **Urban vs. rural.** A settlement is *urban* (gets the NSI town age-share) if it is an
  administrative seat (`PPLC/PPLA/PPLA2/PPLA3`) or has population ≥ 2,000; otherwise *rural*
  (village age-share).
- **Village weighting.** ~6,900 small villages have no GeoNames population, so a province's
  rural cohort total is spread across them with a uniform relative weight
  (`VILLAGE_DEFAULT_WEIGHT`). Only the ratio matters — totals are normalized back to NSI.
- **Travel time.** One-way minutes = `haversine_km / 4.5 km/h × 60` (a walking lower bound).
- **Visit frequency.** `children_0_6` = 180 round-trips/yr, `seniors_65p` = 24/yr.

## Supply breakdown (from OSM)

**2,772** supply nodes nationwide: 147 kindergartens, 234 schools, 204 hospitals,
567 clinics, 1,620 pharmacies. (Pharmacies are the largest set, which is why the frontend
starts that layer hidden.)

## Current snapshot

28 provinces · **2,772** supply nodes · **14,476** demand cells. Placed cohort totals match
NSI to ~0.1% (rounding). Pilot district **Pazardzhik** (a common frontend default): 52
nodes, 272 cells, ≈ **9.2M** wasted hours/year, worst access in remote Rhodope villages
(Barduche, Orlino, Sarnitsa) at 400+ minutes on foot — the education/healthcare deserts the
project targets.

> **Note on demand coverage.** The full backend pipeline distributes the rural residual
> across ~6.9k villages to reach 14,476 demand cells covering the official NSI totals. The
> ml-service uses a leaner settlement-level cache (~349 located settlements, ~82% of NSI
> population), which is sufficient for training the placement models. The two are consistent
> in method but differ in granularity — see [ml-service.md](ml-service.md).

How the inputs become database rows: [data-pipeline.md](data-pipeline.md).
