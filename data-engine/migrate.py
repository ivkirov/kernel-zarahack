"""Idempotent DB schema migration — safe to run on every deploy/boot.

Runs ONLY the dataset-free schema creators, each of which is pure idempotent DDL
(`CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` — never DROP,
never TRUNCATE, never any data change). So the Spring backend, which boots with
hibernate `ddl-auto=validate`, always finds every table it maps — including
tables added by newer commits (e.g. `ai_explanation_cache`) — without a full ETL.

Running this against an already-migrated database is a harmless no-op. It does
NOT seed data: OSM/NSI extraction + `03_seed_postgres` stay in `run_pipeline.py`,
which is dataset-dependent and run separately.

Usage (the auto-deploy calls this via scripts/deploy.sh → scripts/lib.sh):
    cd data-engine && set -a; source ../.env; set +a
    ./venv/bin/python migrate.py
"""

import runpy
import sys

# Order matters only in that each is independent; listed in creation order.
SCHEMA_STEPS = [
    "00_create_schema",            # infrastructure_nodes, demographic_weights
    "00b_create_auth_schema",      # app_users
    "00c_create_ai_cache_schema",  # ai_explanation_cache
]


def main():
    for step in SCHEMA_STEPS:
        print(f"=== migrate: {step} ===", flush=True)
        runpy.run_path(f"{step}.py", run_name="__main__")
    print("Schema migration complete (idempotent — no data touched).", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # surface a clear non-zero exit to the deploy script
        print(f"Schema migration FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
