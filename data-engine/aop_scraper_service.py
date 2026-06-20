"""Civic Accountability Radar — AOP public-procurement scraper (Pillar 3).

Scheduled background service that scrapes the legacy Bulgarian public-procurement
registry (aop.bg), keeps only records describing NEW civic builds (schools,
kindergartens, clinics, hospitals), and caches them — deduplicated — in PostgreSQL
so the Radar UI always has clean, audited data to display.

Runs an immediate scrape on startup, then repeats once every two weeks.

    cd data-engine && set -a; source ../.env; set +a
    ./venv/bin/python aop_scraper_service.py

Reuses the project's standard DB connection (config.pg_dsn → PG* env vars), matching
the rest of the data-engine. See docs/datasets.md for the wider data method.
"""

import logging

import psycopg2
import requests
from apscheduler.schedulers.blocking import BlockingScheduler
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from psycopg2.extras import execute_values

from config import pg_dsn

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  aop-scraper  %(message)s",
)
log = logging.getLogger("aop_scraper")

# --- Target endpoint -------------------------------------------------------- #
# Legacy registry search. The portal predates UTF-8: responses are Windows-1251,
# so we MUST decode explicitly or every Cyrillic field turns to mojibake.
AOP_SEARCH_URL = "http://www.aop.bg/ssearch.php"
RESPONSE_ENCODING = "windows-1251"
REQUEST_TIMEOUT = 20  # seconds — guard against the old portal hanging

# --- Filtering vocabulary (Bulgarian) --------------------------------------- #
# Keep a record only if its description mentions BOTH an action (it's a build)
# AND a target civic amenity. Both gates must pass.
ACTION_KEYWORDS = ["изграждане", "строеж", "ново строителство"]

# Ordered most-specific-first so multi-word / narrower terms win the match:
# "детска градина" before "училище", "поликлиника" before "клиника".
TARGET_AMENITY = {
    "детска градина": "kindergarten",
    "училище":        "school",
    "поликлиника":    "clinic",
    "клиника":        "clinic",
    "болница":        "hospital",
}


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #
DDL = """
CREATE TABLE IF NOT EXISTS planned_municipal_projects (
    id                  BIGSERIAL    PRIMARY KEY,
    procurement_number  VARCHAR(50)  UNIQUE,        -- dedup key
    buyer_name          VARCHAR(255),
    project_name        TEXT,
    amenity_type        VARCHAR(50),
    scraped_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planned_projects_amenity
    ON planned_municipal_projects (amenity_type);
"""


def ensure_schema(conn):
    """Create the cache table + index if they don't already exist (idempotent)."""
    with conn.cursor() as cur:
        cur.execute(DDL)
    conn.commit()


# --------------------------------------------------------------------------- #
# Fetch
# --------------------------------------------------------------------------- #
def fetch_search_html(params=None):
    """GET the registry search page and return it as a decoded str, or None on failure.

    Never raises — a network hiccup must not kill the long-running scheduler.
    """
    try:
        resp = requests.get(AOP_SEARCH_URL, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        log.warning("fetch failed (%s): %s", AOP_SEARCH_URL, exc)
        return None

    # Force the legacy encoding so Bulgarian Cyrillic survives intact.
    resp.encoding = RESPONSE_ENCODING
    return resp.text


# --------------------------------------------------------------------------- #
# Parse  (best-effort, isolated calibration point)
# --------------------------------------------------------------------------- #
def parse_records(html):
    """Extract raw {procurement_number, buyer_name, project_name} rows from the HTML.

    The live AOP table layout could not be verified remotely, so this is deliberately
    defensive: it walks every <tr>, reads its <td> cells positionally, and skips any
    row that doesn't look like a data row. Returns [] (never raises) on empty or
    malformed input.

    >>> CALIBRATION POINT <<<  If AOP's real column order differs, adjust the cell
    indices below against a captured live response — nothing else needs to change.
    """
    if not html:
        return []

    records = []
    try:
        soup = BeautifulSoup(html, "html.parser")
        for row in soup.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) < 3:
                continue  # header, spacer, or non-record row

            number = cells[0].get_text(strip=True)
            buyer = cells[1].get_text(strip=True)
            description = cells[2].get_text(strip=True)

            if not number or not description:
                continue

            records.append({
                "procurement_number": number,
                "buyer_name": buyer,
                "project_name": description,
            })
    except Exception as exc:  # parsing must never crash the service
        log.warning("parse failed: %s", exc)
        return []

    return records


# --------------------------------------------------------------------------- #
# Filter + amenity mapping
# --------------------------------------------------------------------------- #
def classify(description):
    """Return the English amenity_type if the text describes a new civic build, else None.

    Requires at least one ACTION keyword AND at least one TARGET keyword.
    """
    if not description:
        return None
    text = description.lower()

    if not any(action in text for action in ACTION_KEYWORDS):
        return None

    for target, amenity in TARGET_AMENITY.items():
        if target in text:
            return amenity
    return None


# --------------------------------------------------------------------------- #
# Persist
# --------------------------------------------------------------------------- #
def upsert_records(records):
    """Filter to civic builds and INSERT ... ON CONFLICT DO NOTHING (dedup by number).

    Returns the number of records that passed the filter and were sent to the DB.
    Never raises — DB errors are logged and swallowed so the scheduler keeps running.
    """
    if not records:
        log.info("no records to persist")
        return 0

    values = []
    for r in records:
        amenity = classify(r.get("project_name", ""))
        if amenity is None:
            continue
        values.append((
            r["procurement_number"][:50],
            (r.get("buyer_name") or "")[:255],
            r.get("project_name") or "",
            amenity,
        ))

    if not values:
        log.info("scraped %d row(s); 0 matched the civic-build filter", len(records))
        return 0

    try:
        with psycopg2.connect(**pg_dsn()) as conn:
            ensure_schema(conn)
            with conn.cursor() as cur:
                execute_values(cur, """
                    INSERT INTO planned_municipal_projects
                      (procurement_number, buyer_name, project_name, amenity_type)
                    VALUES %s
                    ON CONFLICT (procurement_number) DO NOTHING
                """, values, page_size=500)
            conn.commit()
    except psycopg2.Error as exc:
        log.error("DB write failed: %s", exc)
        return 0

    log.info("scraped %d row(s); %d civic build(s) upserted (dedup on conflict)",
             len(records), len(values))
    return len(values)


# --------------------------------------------------------------------------- #
# Job + scheduler
# --------------------------------------------------------------------------- #
def run_scrape_job():
    """One end-to-end pass: fetch → parse → filter → cache. Self-contained & safe."""
    log.info("scrape job started")
    try:
        html = fetch_search_html()
        records = parse_records(html)
        upsert_records(records)
    except Exception as exc:  # belt-and-braces: a job must never kill the scheduler
        log.exception("scrape job crashed: %s", exc)
    log.info("scrape job finished")


def main():
    # Manual initial run so data extraction is testable immediately, without waiting
    # two weeks for the first scheduled tick.
    run_scrape_job()

    scheduler = BlockingScheduler()
    scheduler.add_job(run_scrape_job, "interval", weeks=2, id="aop_biweekly")
    log.info("scheduler armed: bi-weekly (every 2 weeks). Ctrl-C to stop.")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("scheduler stopped")


if __name__ == "__main__":
    main()
