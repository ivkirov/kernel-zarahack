"""Seed the local PostgreSQL with DUMMY data so the full stack can be exercised
before the real OSM/NSI files arrive.

Inserts ~20 fake infrastructure_nodes (kindergartens, schools, hospitals, clinics)
and ~30 fake demographic_weights rows (children_0_6 + seniors_65p), all scattered
around Pazardzhik. Uses the same psycopg2 DSN + execute_values pattern as
03_seed_postgres.py. Deterministic (fixed RNG seed) for reproducible demos.

    python 99_seed_dummy.py
"""

import random

import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

from config import pg_dsn, ACTIVE_DISTRICT

load_dotenv()

RNG = random.Random(42)

# Scatter window around Pazardzhik town (deliberately wider than a single cluster
# so the choropleth and simulation deltas are visibly varied).
LAT_MIN, LAT_MAX = 42.00, 42.30
LON_MIN, LON_MAX = 24.00, 24.50


def _jitter_lat():
    return round(RNG.uniform(LAT_MIN, LAT_MAX), 6)


def _jitter_lon():
    return round(RNG.uniform(LON_MIN, LON_MAX), 6)


# --- ~20 infrastructure nodes: (service_type, name) ---
NODE_SPECS = [
    ("kindergarten", "Kindergarten Prolet"),
    ("kindergarten", "Kindergarten Zvanche"),
    ("kindergarten", "Kindergarten Slanze"),
    ("kindergarten", "Kindergarten Detelina"),
    ("kindergarten", "Kindergarten Rosica"),
    ("kindergarten", "Kindergarten Mecho Pooh"),
    ("school",       "Hristo Botev School"),
    ("school",       "Vasil Levski School"),
    ("school",       "Ivan Vazov School"),
    ("school",       "Hristo Smirnenski School"),
    ("school",       "Stefan Karadzha School"),
    ("hospital",     "MBAL Pazardzhik Hospital"),
    ("hospital",     "Velingrad General Hospital"),
    ("hospital",     "Peshtera Regional Hospital"),
    ("hospital",     "Panagyurishte District Hospital"),
    ("clinic",       "Septemvri Polyclinic"),
    ("clinic",       "Batak Health Center"),
    ("clinic",       "Belovo Medical Center"),
    ("clinic",       "Bratsigovo Clinic"),
    ("clinic",       "Strelcha Clinic"),
]

# --- ~15 settlements → 30 demographic_weights rows (one per group) ---
SETTLEMENTS = [
    "Pazardzhik", "Velingrad", "Peshtera", "Septemvri", "Panagyurishte",
    "Batak", "Belovo", "Bratsigovo", "Strelcha", "Rakitovo",
    "Sarnitsa", "Lesichovo", "Vetren", "Krichim", "Sinitevo",
]


def build_node_rows():
    rows = []
    for i, (service_type, name) in enumerate(NODE_SPECS):
        rows.append((
            -(1000 + i),          # synthetic osm_id (negative → clearly not real OSM)
            service_type,
            service_type,         # amenity_raw mirrors service_type for dummy data
            name,
            _jitter_lat(),
            _jitter_lon(),
            ACTIVE_DISTRICT,
            False,                # is_simulated
        ))
    return rows


def build_weight_rows():
    rows = []
    for i, settlement in enumerate(SETTLEMENTS):
        cell_id = f"{ACTIVE_DISTRICT}-DUMMY-{i:04d}"
        lat, lon = _jitter_lat(), _jitter_lon()  # both groups share the cell centroid
        children = RNG.randint(20, 400)
        seniors = RNG.randint(30, 600)
        rows.append((cell_id, settlement, ACTIVE_DISTRICT, lat, lon, "children_0_6", children))
        rows.append((cell_id, settlement, ACTIVE_DISTRICT, lat, lon, "seniors_65p",  seniors))
    return rows


def main():
    node_rows = build_node_rows()
    weight_rows = build_weight_rows()

    with psycopg2.connect(**pg_dsn()) as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE infrastructure_nodes RESTART IDENTITY;")
            execute_values(cur, """
                INSERT INTO infrastructure_nodes
                  (osm_id, service_type, amenity_raw, name, lat, lon, district, is_simulated)
                VALUES %s
            """, node_rows, page_size=500)

            cur.execute("TRUNCATE demographic_weights RESTART IDENTITY;")
            execute_values(cur, """
                INSERT INTO demographic_weights
                  (cell_id, settlement, district, lat, lon, group_key, population)
                VALUES %s
            """, weight_rows, page_size=500)
        conn.commit()

    print(f"Seeded {len(node_rows)} dummy infrastructure_nodes")
    print(f"Seeded {len(weight_rows)} dummy demographic_weights")
    print(f"District: {ACTIVE_DISTRICT}. Dummy data only — replace via run_pipeline.py "
          f"once raw OSM/NSI files are available.")


if __name__ == "__main__":
    main()
