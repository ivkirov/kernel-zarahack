"""Creates the two core tables in the local PostgreSQL instance."""

import psycopg2
from dotenv import load_dotenv
from config import pg_dsn

load_dotenv()

DDL = """
-- Raw essential-service locations extracted from OSM
CREATE TABLE IF NOT EXISTS infrastructure_nodes (
    id            BIGSERIAL PRIMARY KEY,
    osm_id        BIGINT,
    service_type  VARCHAR(32)      NOT NULL,   -- kindergarten|school|hospital|clinic|pharmacy
    amenity_raw   VARCHAR(64),                 -- original OSM amenity tag
    name          VARCHAR(256),
    lat           DOUBLE PRECISION NOT NULL,
    lon           DOUBLE PRECISION NOT NULL,
    district      VARCHAR(64)      NOT NULL,
    is_simulated  BOOLEAN          NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_nodes_type_district
    ON infrastructure_nodes (service_type, district);

-- Demographic density weights per spatial cell / settlement
CREATE TABLE IF NOT EXISTS demographic_weights (
    id             BIGSERIAL PRIMARY KEY,
    cell_id        VARCHAR(64)      NOT NULL,  -- settlement code or grid id
    settlement     VARCHAR(256),
    district       VARCHAR(64)      NOT NULL,
    lat            DOUBLE PRECISION NOT NULL,  -- cell centroid
    lon            DOUBLE PRECISION NOT NULL,
    group_key      VARCHAR(32)      NOT NULL,  -- children_0_6 | seniors_65p
    population     INTEGER          NOT NULL,  -- W: persons in group in this cell
    UNIQUE (cell_id, group_key)
);

CREATE INDEX IF NOT EXISTS idx_weights_district_group
    ON demographic_weights (district, group_key);
"""

def main():
    with psycopg2.connect(**pg_dsn()) as conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
        conn.commit()
    print("Schema created/verified: infrastructure_nodes, demographic_weights")

if __name__ == "__main__":
    main()
