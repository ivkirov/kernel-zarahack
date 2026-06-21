"""Creates the AI-explanation cache table in the local PostgreSQL instance.

The personal area-suggestion feature attaches a short AI write-up to every
suggested place. Generating those with Gemini is slow and costs tokens, and the
text depends ONLY on the spot + the household's filters (needs / car / language)
— never on who is asking. So we cache one row per (spot, filters): the first
request for a given combination generates it, everyone after reads it back.

Kept separate from the geospatial + auth schemas because, like app_users, this
is an app concern. The Spring backend runs with hibernate ddl-auto=validate, so
this table must exist before it boots.
"""

import psycopg2
from dotenv import load_dotenv
from config import pg_dsn

load_dotenv()

DDL = """
-- Cached AI explanations, keyed by a hash of (kind, rounded spot, filters).
--   cache_key:   sha256 hex of the canonical "kind|lat|lon|needs|has_car|language"
--   kind:        explanation family (currently only 'personal_area')
--   needs:       sorted, comma-joined household needs the text was grounded on
-- The unique cache_key is the lookup; the readable columns are for debugging.
CREATE TABLE IF NOT EXISTS ai_explanation_cache (
    id           BIGSERIAL PRIMARY KEY,
    cache_key    VARCHAR(128)     NOT NULL UNIQUE,
    kind         VARCHAR(32)      NOT NULL,
    lat          DOUBLE PRECISION NOT NULL,
    lon          DOUBLE PRECISION NOT NULL,
    needs        VARCHAR(256),
    has_car      BOOLEAN,
    language     VARCHAR(8),
    explanation  TEXT             NOT NULL,
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_key ON ai_explanation_cache (cache_key);
"""

def main():
    with psycopg2.connect(**pg_dsn()) as conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
        conn.commit()
    print("Schema created/verified: ai_explanation_cache")

if __name__ == "__main__":
    main()
