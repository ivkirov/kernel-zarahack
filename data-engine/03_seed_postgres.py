"""Bulk-load the two CSVs into the local PostgreSQL via psycopg2."""

import csv
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
from config import pg_dsn, OUT_DIR

load_dotenv()

def seed_nodes(cur):
    path = OUT_DIR / "infrastructure_nodes.csv"
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    values = [
        (int(r["osm_id"]), r["service_type"], r["amenity_raw"], r["name"],
         float(r["lat"]), float(r["lon"]), r["district"], False)
        for r in rows
    ]
    cur.execute("TRUNCATE infrastructure_nodes RESTART IDENTITY;")
    execute_values(cur, """
        INSERT INTO infrastructure_nodes
          (osm_id, service_type, amenity_raw, name, lat, lon, district, is_simulated)
        VALUES %s
    """, values, page_size=500)
    print(f"Seeded {len(values)} infrastructure_nodes")

def seed_weights(cur):
    path = OUT_DIR / "demographic_weights.csv"
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    values = [
        (r["cell_id"], r["settlement"], r["district"],
         float(r["lat"]), float(r["lon"]), r["group_key"], int(r["population"]))
        for r in rows
    ]
    cur.execute("TRUNCATE demographic_weights RESTART IDENTITY;")
    execute_values(cur, """
        INSERT INTO demographic_weights
          (cell_id, settlement, district, lat, lon, group_key, population)
        VALUES %s
    """, values, page_size=500)
    print(f"Seeded {len(values)} demographic_weights")

def main():
    with psycopg2.connect(**pg_dsn()) as conn:
        with conn.cursor() as cur:
            seed_nodes(cur)
            seed_weights(cur)
        conn.commit()
    print("Seeding complete.")

if __name__ == "__main__":
    main()
