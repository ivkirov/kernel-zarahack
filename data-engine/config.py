"""Central config for the Reclaim data engine.

Real data sources (read straight from the gitignored ../datasets/ folder):
  - OSM .pbf  -> supply nodes (kindergartens, schools, hospitals, clinics, pharmacies)
  - NSI xlsx  -> demand weights (population by province x age x urban/rural)
  - GeoNames  -> geocoding backbone (every settlement's lat/lon + province + size)
See docs/datasets.md and docs/data-pipeline.md for the full method.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATASETS_DIR = BASE_DIR.parent / "datasets"
OUT_DIR = BASE_DIR / "out"
OUT_DIR.mkdir(exist_ok=True)

# --- Raw inputs (the files the user downloaded into ../datasets) ---
PBF_PATH          = DATASETS_DIR / "bulgaria-260618.osm.pbf"
NSI_XLSX_PATH     = DATASETS_DIR / "Население по области, възраст, местоживеене и пол.xlsx"
GEONAMES_ZIP      = DATASETS_DIR / "BG.zip"
GEONAMES_MEMBER   = "BG.txt"
BOUNDARIES_GEOJSON = DATASETS_DIR / "geoBoundaries-BGR-ADM2_simplified.geojson"  # optional map overlay

# --- Seed scope ---
# True  -> extract & seed all 28 provinces (the `district` column carries each name).
# The frontend still boots into ACTIVE_DISTRICT; the others are query-switchable.
SEED_NATIONWIDE = os.getenv("TPM_NATIONWIDE", "1") != "0"
ACTIVE_DISTRICT = os.getenv("TPM_DISTRICT", "Stara Zagora")

# --- Province crosswalk: NSI Cyrillic name -> (GeoNames admin1 code, app/Latin name) ---
# Bulgaria's 28 oblasti. GeoNames tags every settlement with the admin1 code; NSI labels
# rows in Cyrillic; the frontend speaks the Latin name. This dict ties the three together.
PROVINCES = {
    "Благоевград":     ("38", "Blagoevgrad"),
    "Бургас":          ("39", "Burgas"),
    "Добрич":          ("40", "Dobrich"),
    "Габрово":         ("41", "Gabrovo"),
    "София (столица)": ("42", "Sofia (Capital)"),
    "Хасково":         ("43", "Haskovo"),
    "Кърджали":        ("44", "Kardzhali"),
    "Кюстендил":       ("45", "Kyustendil"),
    "Ловеч":           ("46", "Lovech"),
    "Монтана":         ("47", "Montana"),
    "Пазарджик":       ("48", "Pazardzhik"),
    "Перник":          ("49", "Pernik"),
    "Плевен":          ("50", "Pleven"),
    "Пловдив":         ("51", "Plovdiv"),
    "Разград":         ("52", "Razgrad"),
    "Русе":            ("53", "Ruse"),
    "Шумен":           ("54", "Shumen"),
    "Силистра":        ("55", "Silistra"),
    "Сливен":          ("56", "Sliven"),
    "Смолян":          ("57", "Smolyan"),
    "София":           ("58", "Sofia Province"),
    "Стара Загора":    ("59", "Stara Zagora"),
    "Търговище":       ("60", "Targovishte"),
    "Варна":           ("61", "Varna"),
    "Велико Търново":  ("62", "Veliko Tarnovo"),
    "Видин":           ("63", "Vidin"),
    "Враца":           ("64", "Vratsa"),
    "Ямбол":           ("65", "Yambol"),
}
ADMIN1_TO_DISTRICT = {a1: latin for (a1, latin) in PROVINCES.values()}

# --- OSM amenity -> our normalized service_type + the demand group it serves ---
AMENITY_MAP = {
    "kindergarten": ("kindergarten", "children_0_6"),
    "school":       ("school",       "children_0_6"),
    "hospital":     ("hospital",     "seniors_65p"),
    "clinic":       ("clinic",       "seniors_65p"),
    "doctors":      ("clinic",       "seniors_65p"),
    "pharmacy":     ("pharmacy",     "seniors_65p"),
}

# --- NSI age bands -> our two cohorts ---
# Bands are 5-year ('5 - 9') except age 0. To approximate the 0-6 cohort we take all of
# ages 0-4 plus 2/5 of the 5-9 band (ages 5 & 6, assuming a uniform spread of single years).
CHILD_BANDS  = {"0": 1.0, "1 - 4": 1.0, "5 - 9": 2.0 / 5.0}
SENIOR_BANDS = {b: 1.0 for b in
                ["65 - 69", "70 - 74", "75 - 79", "80 - 84",
                 "85 - 89", "90 - 94", "95 - 99", "100 +"]}

# --- Urban/rural classification of a GeoNames place ---
# NSI splits each province into "в градовете" (urban) and "в селата" (rural); we apply the
# matching age-share to each settlement. A place counts as urban if it is an administrative
# seat or clears a town-size population threshold; everything else is treated as a village.
URBAN_FCODES = {"PPLC", "PPLA", "PPLA2", "PPLA3"}
URBAN_POP_THRESHOLD = 2000
# Relative weight used to spread a province's rural population across villages GeoNames lists
# without a population figure (~6.9k of them). Only the *ratio* matters: totals are normalized
# back to NSI, so this just shares the rural residual roughly evenly across small villages.
VILLAGE_DEFAULT_WEIGHT = 250

# --- Travel-time proxy (one-way minutes = haversine_km / speed * 60) ---
ASSUMED_SPEED_KMH = float(os.getenv("TPM_SPEED_KMH", "4.5"))

# --- Annual round-trips per group (drives the wasted-hours math in the backend) ---
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
