"""Creates the auth/user-management table in the local PostgreSQL instance.

Kept separate from 00_create_schema.py (the geospatial tables) because user
accounts are an app concern, not part of the ETL data model. The Spring backend
runs with hibernate ddl-auto=validate, so this table must exist before it boots.
"""

import psycopg2
from dotenv import load_dotenv
from config import pg_dsn

load_dotenv()

DDL = """
-- Application accounts for roles, paid tiers and usage-based limits.
--   role:           ADMIN | FREE_USER | PAID_USER | REPORTER | MUNICIPALITY
--   access_granted: paid access activated by an admin (irrelevant for FREE_USER/ADMIN)
--   free_guesses_used: usage counter for the free tier's relocation checks
CREATE TABLE IF NOT EXISTS app_users (
    id                 BIGSERIAL PRIMARY KEY,
    email              VARCHAR(256) NOT NULL UNIQUE,
    password_hash      VARCHAR(512) NOT NULL,
    display_name       VARCHAR(128),
    role               VARCHAR(32)  NOT NULL,
    access_granted     BOOLEAN      NOT NULL DEFAULT FALSE,
    free_guesses_used  INTEGER      NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users (email);
"""

def main():
    with psycopg2.connect(**pg_dsn()) as conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
        conn.commit()
    print("Schema created/verified: app_users")

if __name__ == "__main__":
    main()
