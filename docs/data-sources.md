# Data Sources & Provenance

This project fuses two public datasets into a neighborhood-level **Time Poverty Score**.
Until the raw files are sourced, the stack is exercised against dummy data
(`data-engine/99_seed_dummy.py`).

## 1. OpenStreetMap — Essential Service Locations

- **Source:** Geofabrik Bulgaria country extract (Protocolbuffer Binary Format, `.pbf`).
- **URL:** https://download.geofabrik.de/europe/bulgaria-latest.osm.pbf (~450 MB)
- **MD5:** https://download.geofabrik.de/europe/bulgaria-latest.osm.pbf.md5
- **Local path:** `data-engine/raw/bulgaria-latest.osm.pbf` (gitignored)
- **Extracted by:** `data-engine/01_extract_osm.py` (pyosmium, fully offline).
- **Amenities captured** (`config.AMENITY_MAP`): `kindergarten`, `school` → children 0–6;
  `hospital`, `clinic`, `doctors`, `pharmacy` → seniors 65+.
- **License:** © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).

## 2. National Statistical Institute (NSI) — Demographic Weights

- **Source:** NSI population-by-age workbook (Excel, multi-sheet).
- **Local path:** `data-engine/raw/nsi_population_2021.xlsx` (gitignored)
- **Extracted by:** `data-engine/02_extract_nsi.py` (pandas + openpyxl).
- **Target cohorts:** children 0–6 (early-education stress), seniors 65+ (healthcare deserts).
- **Note:** Column labels and header rows vary by release year — inspect the workbook first
  (see §3.5 of `JUMPSTART.md`) and adjust `HEADER_ROW` / age-band columns in `02_extract_nsi.py`.
- **Centroid limitation:** without per-settlement coordinates, cells fall back to the district
  bbox center. Upgrade path: join an `settlement_coords.csv` (EKATTE code → lat/lon).
- **License:** NSI open data — cite the table ID(s) used on the final slide.

## 3. Travel-Time Proxy

No routing server is used. One-way travel time is a deterministic, defensible lower bound:

```
T_nearest = (haversine_distance_km / ASSUMED_SPEED_KMH) × 60   [minutes]
```

Default `ASSUMED_SPEED_KMH = 4.5` (walk/local-mobility persona). Configurable via
`TPM_SPEED_KMH`.
