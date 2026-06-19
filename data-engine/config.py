"""Central config for the Time Poverty Matrix data engine."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
RAW_DIR = BASE_DIR / "raw"
OUT_DIR = BASE_DIR / "out"
OUT_DIR.mkdir(exist_ok=True)

PBF_PATH = RAW_DIR / "bulgaria-latest.osm.pbf"
NSI_XLSX_PATH = RAW_DIR / "nsi_population_2021.xlsx"

# --- Pilot district selection (bounding boxes: min_lon, min_lat, max_lon, max_lat) ---
# Choose ONE active district for the hackathon demo; others kept for reference.
DISTRICTS = {
    "Pazardzhik":  (23.80, 41.95, 24.60, 42.55),
    "Blagoevgrad": (22.80, 41.30, 23.60, 42.30),
    "Sofia":       (23.10, 42.55, 23.55, 42.80),
}
ACTIVE_DISTRICT = os.getenv("TPM_DISTRICT", "Pazardzhik")
ACTIVE_BBOX = DISTRICTS[ACTIVE_DISTRICT]

# --- OSM amenity → our normalized service_type ---
# OSM tag value : (service_type, target demographic group)
AMENITY_MAP = {
    "kindergarten": ("kindergarten", "children_0_6"),
    "school":       ("school",       "children_0_6"),
    "hospital":     ("hospital",     "seniors_65p"),
    "clinic":       ("clinic",       "seniors_65p"),
    "doctors":      ("clinic",       "seniors_65p"),
    "pharmacy":     ("pharmacy",     "seniors_65p"),
}

# --- Travel-time proxy ---
ASSUMED_SPEED_KMH = float(os.getenv("TPM_SPEED_KMH", "4.5"))

# --- Annual visit frequency per group (round trips/year) ---
VISITS_PER_YEAR = {
    "children_0_6": 180,
    "seniors_65p":  24,
}

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
