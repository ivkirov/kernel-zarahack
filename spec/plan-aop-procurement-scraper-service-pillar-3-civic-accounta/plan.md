# Plan — AOP Procurement Scraper Service (Pillar 3: Civic Accountability Radar)

## Context

The project is adding a 3rd pillar, the **Civic Accountability Radar**, which will surface
live Bulgarian public-procurement records for new civic builds (schools, kindergartens,
clinics, hospitals). Today there is **no** Radar code, endpoint, or placeholder JSON in the
repo (verified by repo-wide search) — this is a clean slate. We need a scheduled scraper in
`data-engine/` that pulls procurement records from the legacy AOP registry, filters them to
"new civic construction", and caches them (deduplicated) in PostgreSQL so a future serving
layer can read clean, audited data.

**Verified facts that shape the design:**
- The existing data-engine connects via `config.pg_dsn()` (reads `PGHOST/PGPORT/PGDATABASE/
  PGUSER/PGPASSWORD/PGSSLMODE`). **Decision (confirmed with user): reuse `pg_dsn()`** — not
  the `DB_*` names in the original spec, which would silently fail against the current local
  `.env`.
- `data-engine/requirements.txt` already has `psycopg2-binary==2.9.9` but is **missing**
  `requests`, `beautifulsoup4`, and `apscheduler` — these must be added.
- A WebFetch of `http://www.aop.bg/ssearch.php` returned garbled Cyrillic (block chars),
  which **confirms the page is non-UTF-8 (Windows-1251)** — validating the decoding
  requirement. It could **not** confirm the exact HTML table structure remotely, so the
  HTML-parsing function must be **defensive/best-effort** and isolated for easy calibration
  against the real response.
- Conventions to match: `from dotenv import load_dotenv; load_dotenv()` at module top;
  `with psycopg2.connect(**pg_dsn()) as conn:`; `CREATE TABLE IF NOT EXISTS` idempotent DDL;
  `idx_<table>_<cols>` index naming; standalone `main()` + `if __name__ == "__main__"`.

**Scope of this task:** the single file `data-engine/aop_scraper_service.py` plus the three
new dependencies. Wiring a serving endpoint (Java/FastAPI) and a frontend Radar layer is
explicit **follow-up**, noted below but not built here.

## Files

```
data-engine/aop_scraper_service.py   (NEW — the scraper service)
data-engine/requirements.txt         (EDIT — add requests, beautifulsoup4, apscheduler)
```

## Step 1 — `data-engine/aop_scraper_service.py`

A self-contained service following the existing module style.

**Imports & config**
- `requests`, `bs4.BeautifulSoup`, `psycopg2`, `psycopg2.extras.execute_values`,
  `apscheduler.schedulers.blocking.BlockingScheduler`, `logging`, `from dotenv import
  load_dotenv`, `from config import pg_dsn`.
- `load_dotenv()` at module load. Module `logging` logger (INFO).
- Constants:
  - `AOP_SEARCH_URL = "http://www.aop.bg/ssearch.php"`
  - `RESPONSE_ENCODING = "windows-1251"`
  - `REQUEST_TIMEOUT = 20`
  - `ACTION_KEYWORDS = ["изграждане", "строеж", "ново строителство"]`
  - `TARGET_AMENITY` ordered map (specific keys first so multi-word / narrower terms win):
    ```python
    TARGET_AMENITY = {
        "детска градина": "kindergarten",
        "училище":        "school",
        "поликлиника":    "clinic",
        "клиника":        "clinic",
        "болница":        "hospital",
    }
    ```

**DDL — `ensure_schema(conn)`** (idempotent, house style):
```sql
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
```
(All four spec columns present; `procurement_number` is the UNIQUE dedup key. `scraped_at`
is a small, convention-consistent audit addition.)

**Fetch — `fetch_search_html(params=None) -> str | None`**
- `requests.get(AOP_SEARCH_URL, params=params, timeout=REQUEST_TIMEOUT)` inside
  `try/except requests.RequestException` → log + return `None` (never raise into scheduler).
- Explicit decode: `resp.encoding = RESPONSE_ENCODING; return resp.text` (equivalently
  `resp.content.decode("windows-1251", errors="replace")`) so Cyrillic survives.

**Parse — `parse_records(html) -> list[dict]`** (defensive calibration point)
- `BeautifulSoup(html, "html.parser")`; iterate `tr` rows, read `td` cells with length
  guards, skip header/short rows, extract `procurement_number`, `buyer_name`,
  `project_name` via `.get_text(strip=True)`. Clearly commented as the spot to tune to AOP's
  real column order. Returns `[]` on empty/malformed input (never raises).

**Filter + map — `classify(description) -> str | None`**
- Lowercase once; require **≥1 action keyword AND ≥1 target keyword**; return the English
  `amenity_type` for the first matching target (specificity-ordered), else `None`.

**Persist — `upsert_records(records)`**
- `with psycopg2.connect(**pg_dsn()) as conn:` → `ensure_schema(conn)` → keep only records
  passing `classify()` → `execute_values` with
  `INSERT INTO planned_municipal_projects (procurement_number, buyer_name, project_name,
  amenity_type) VALUES %s ON CONFLICT (procurement_number) DO NOTHING`, `page_size=500`.
- `try/except psycopg2.Error` → log + return. Early-return on empty list. Log scraped/kept
  counts.

**Job — `run_scrape_job()`**
- fetch → parse → filter/classify → upsert, wrapped in top-level try/except so one bad run
  never kills the scheduler. One-line summary log.

**Scheduler / runtime — `main()`**
- `BlockingScheduler()`; `add_job(run_scrape_job, "interval", weeks=2, id="aop_biweekly")`.
- **Manual initial run on startup**: call `run_scrape_job()` once immediately (testable now),
  then `scheduler.start()` inside `try/except (KeyboardInterrupt, SystemExit)`.
- `if __name__ == "__main__": main()`.

## Step 2 — `data-engine/requirements.txt`

Append pinned deps (keep existing lines):
```
requests==2.32.3
beautifulsoup4==4.12.3
apscheduler==3.10.4
```

## Known limitations / follow-up (not built here)

- **No geocoding / coordinates.** The spec's 4-column schema has no lat/lon, so rows aren't
  yet map-plottable. Natural next step: geocode `buyer_name`/municipality via the existing
  `data-engine/geonames.py` backbone and add `lat/lon` — deferred until the serving layer is
  designed.
- **Serving layer is future work.** No Java/FastAPI endpoint or frontend Radar layer exists
  yet; this task only produces the cached table. Wiring `GET /planned-projects` + a Leaflet
  layer is a separate change.
- **Parser calibration.** AOP's real column order / whether `ssearch.php` needs POST search
  params couldn't be verified remotely; `parse_records()` is isolated and defensive so it
  can be tuned against a captured live response.

## Verification

1. **Deps:** `cd data-engine && ./venv/bin/pip install -r requirements.txt`.
2. **Import/syntax:** `./venv/bin/python -c "import aop_scraper_service"` (confirms imports +
   `from config import pg_dsn` resolve, no raise).
3. **DB smoke (no network):** with `set -a; source ../.env; set +a`, call `ensure_schema` +
   `upsert_records([...sample...])`, then `psql -c "SELECT procurement_number, amenity_type
   FROM planned_municipal_projects;"` — confirms table creation, amenity mapping, and that a
   repeat insert of the same `procurement_number` is a no-op (ON CONFLICT dedup).
4. **Filter unit check:** `classify("изграждане на детска градина")` → `kindergarten`;
   `classify("ремонт на път")` → `None` (fails both-gates) — confirms AND logic.
5. **End-to-end (live, best-effort):** `./venv/bin/python aop_scraper_service.py` → the
   startup run logs fetch→parse→insert counts and the bi-weekly job arms. If live HTML
   differs from the assumed layout, calibrate `parse_records()` (expected, per limitations).
