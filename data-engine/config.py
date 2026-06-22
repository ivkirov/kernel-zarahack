"""Central config for the Reclaim data engine.

Everything region-specific is loaded from the shared region YAML (repo-root
``config/region.yaml``, falling back to ``config/region.example.yaml``) — the same
file the ML service reads. Override the path with ``REGION_CONFIG``. This module
keeps its long-standing public names (``PBF_PATH``, ``PROVINCES``, ``AMENITY_MAP``,
…) so every ETL step keeps working; only their *source* moved into config.

Real data sources (read straight from the gitignored ../datasets/ folder):
  - OSM .pbf  -> supply nodes (kindergartens, schools, hospitals, clinics, pharmacies)
  - NSI xlsx  -> demand weights (population by province x age x urban/rural)
  - GeoNames  -> geocoding backbone (every settlement's lat/lon + province + size)
See docs/datasets.md and docs/data-pipeline.md for the full method.
"""

import os
from pathlib import Path

import yaml

BASE_DIR = Path(__file__).resolve().parent
REPO_DIR = BASE_DIR.parent
OUT_DIR = BASE_DIR / "out"
OUT_DIR.mkdir(exist_ok=True)


# --- Load the region config (single source of truth) ----------------------- #
def _region_config_path() -> Path:
    for c in (os.getenv("REGION_CONFIG"),
              REPO_DIR / "config" / "region.yaml",
              REPO_DIR / "config" / "region.example.yaml"):
        if c and Path(c).exists():
            return Path(c)
    raise FileNotFoundError(
        "No region config found. Create config/region.yaml from "
        "config/region.example.yaml, or set REGION_CONFIG=/path/to/region.yaml."
    )


with open(_region_config_path(), encoding="utf-8") as _f:
    _CFG = yaml.safe_load(_f)

_ds = Path(_CFG["datasets_dir"])
DATASETS_DIR = _ds if _ds.is_absolute() else REPO_DIR / _ds


def _dataset(key: str) -> Path:
    return DATASETS_DIR / _CFG["datasets"][key]


# --- Raw inputs (the files the user downloaded into ../datasets) ---
PBF_PATH           = _dataset("osm_pbf")
NSI_XLSX_PATH      = _dataset("nsi_xlsx")
GEONAMES_ZIP       = _dataset("geonames_zip")
GEONAMES_MEMBER    = _CFG["datasets"]["geonames_member"]
BOUNDARIES_GEOJSON = _dataset("boundaries_geojson")   # optional map overlay

# --- Seed scope (env still wins, for ad-hoc runs) ---
# True  -> extract & seed all provinces (the `district` column carries each name).
# The frontend still boots into ACTIVE_DISTRICT; the others are query-switchable.
SEED_NATIONWIDE = os.getenv("TPM_NATIONWIDE", "1" if _CFG["seed_nationwide"] else "0") != "0"
ACTIVE_DISTRICT = os.getenv("TPM_DISTRICT", _CFG["active_district"])

# --- Province crosswalk: census name -> (GeoNames admin1 code, app/Latin name) ---
# GeoNames tags every settlement with the admin1 code; the census labels rows in
# its own language; the frontend speaks the Latin name. This dict ties the three.
PROVINCES = {cyr: (code, latin) for cyr, (code, latin) in
             ((k, tuple(v)) for k, v in _CFG["provinces"].items())}
ADMIN1_TO_DISTRICT = {a1: latin for (a1, latin) in PROVINCES.values()}

# --- OSM amenity -> our normalized service_type + the demand group it serves ---
AMENITY_MAP = {k: tuple(v) for k, v in _CFG["amenity_map"].items()}

# --- Census age bands -> our two cohorts ---
# Bands are 5-year ('5 - 9') except age 0. To approximate the 0-6 cohort we take all
# of ages 0-4 plus 2/5 of the 5-9 band (ages 5 & 6, assuming a uniform spread).
CHILD_BANDS  = dict(_CFG["child_bands"])
SENIOR_BANDS = {b: 1.0 for b in _CFG["senior_bands"]}

# --- Urban/rural classification of a GeoNames place ---
# A place counts as urban if it is an administrative seat or clears a town-size
# population threshold; everything else is treated as a village.
URBAN_FCODES = set(_CFG["urban_fcodes"])
URBAN_POP_THRESHOLD = int(_CFG["urban_pop_threshold"])
# Relative weight used to spread a province's rural population across villages
# GeoNames lists without a population figure. Only the *ratio* matters: totals are
# normalized back to the census, so this just shares the rural residual evenly.
VILLAGE_DEFAULT_WEIGHT = int(_CFG["village_default_weight"])

# --- Travel-time proxy (one-way minutes = haversine_km / speed * 60) ---
ASSUMED_SPEED_KMH = float(os.getenv("TPM_SPEED_KMH", str(_CFG["assumed_speed_kmh"])))

# --- Annual round-trips per group (drives the wasted-hours math in the backend) ---
VISITS_PER_YEAR = dict(_CFG["visits_per_year"])


# --- DB connection (env-driven; loaded via python-dotenv) ---
def pg_dsn() -> dict:
    return {
        "host":     os.environ["PGHOST"],
        "port":     int(os.getenv("PGPORT", "5432")),
        "dbname":   os.environ["PGDATABASE"],
        "user":     os.environ["PGUSER"],
        "password": os.environ["PGPASSWORD"],
        "sslmode":  os.getenv("PGSSLMODE", "disable"),
    }
