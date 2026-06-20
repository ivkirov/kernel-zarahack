"""Run the full ETL in order. Assumes .env is populated and raw files present."""
import runpy

for step in ["00_create_schema", "00b_create_auth_schema", "01_extract_osm", "02_extract_nsi", "03_seed_postgres"]:
    print(f"\n=== {step} ===")
    runpy.run_path(f"{step}.py", run_name="__main__")

print("\nPipeline finished. Postgres is seeded.")
