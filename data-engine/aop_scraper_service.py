"""Civic Accountability Radar — AOP public-procurement scraper (Pillar 3).

Scheduled background service that scrapes the legacy Bulgarian public-procurement
registry (aop.bg), keeps only records describing NEW civic builds (schools,
kindergartens, clinics, hospitals), geocodes their build location, and caches them —
deduplicated — in PostgreSQL so the Radar UI has clean, audited data to display.

How it really works against aop.bg (verified live):
  1. Quick-search:  GET ssearch.php?mode=search&word=<TERM>  with TERM Windows-1251
     encoded. Results are vertical label:value blocks of <tr class="odd|even">; each
     record exposes a document id + an "Описание" (subject) + a detail-page link.
  2. Detail page:   GET ng/form.php?id=<ID>&mode=view  →  buyer ("Официално
     наименование") and the build location ("Основно място на изпълнение: гр. X").
  3. Geocode the build town against the project's local GeoNames gazetteer (offline,
     no external geocoder) → lat/lon + Latin province for the ML audit.

Runs an immediate scrape on startup, then repeats once every two weeks.

    cd data-engine && set -a; source ../.env; set +a
    ./venv/bin/python aop_scraper_service.py
"""

import csv
import io
import logging
import re
import sys
import time
import zipfile
from urllib.parse import quote, urljoin

import psycopg2
import requests
from apscheduler.schedulers.blocking import BlockingScheduler
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from psycopg2.extras import execute_values

from config import (ADMIN1_TO_DISTRICT, GEONAMES_MEMBER, GEONAMES_ZIP, pg_dsn)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  aop-scraper  %(message)s",
)
log = logging.getLogger("aop_scraper")

# --- Target endpoint -------------------------------------------------------- #
# Legacy registry. The portal predates UTF-8: requests AND responses are Windows-1251,
# so the search term must be cp1251-encoded and responses decoded explicitly.
AOP_BASE = "https://www.aop.bg/"
AOP_SEARCH_URL = AOP_BASE + "ssearch.php"
RESPONSE_ENCODING = "windows-1251"
REQUEST_TIMEOUT = 25
USER_AGENT = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120 Safari/537.36")
# Politeness / safety caps for a single run against a .gov host.
MAX_DETAILS_PER_TERM = 8
DETAIL_DELAY_SEC = 0.5

# --- Filtering vocabulary (Bulgarian) --------------------------------------- #
# A record is kept only if its text mentions BOTH an action (it's a build) AND a
# target civic amenity. The TARGET keys double as the search terms.
ACTION_KEYWORDS = ["изграждане", "строеж", "ново строителство", "строителство", "проектиране"]

# Ordered most-specific-first so narrower terms win: "детска градина" before "училище".
TARGET_AMENITY = {
    "детска градина": "kindergarten",
    "училище":        "school",
    "поликлиника":    "clinic",
    "болница":        "hospital",
}


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #
DDL = """
CREATE TABLE IF NOT EXISTS planned_municipal_projects (
    id                  BIGSERIAL    PRIMARY KEY,
    procurement_number  VARCHAR(50)  UNIQUE,        -- dedup key (AOP document id)
    buyer_name          VARCHAR(255),
    project_name        TEXT,
    amenity_type        VARCHAR(50),
    lat                 DOUBLE PRECISION,
    lon                 DOUBLE PRECISION,
    district            VARCHAR(80),
    scraped_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planned_projects_amenity
    ON planned_municipal_projects (amenity_type);
"""


def ensure_schema(conn):
    """Create the cache table + index if they don't already exist (idempotent)."""
    with conn.cursor() as cur:
        cur.execute(DDL)
        # Tolerate a pre-existing table created by an older version without coords.
        cur.execute("""
            ALTER TABLE planned_municipal_projects
              ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
              ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION,
              ADD COLUMN IF NOT EXISTS district VARCHAR(80)
        """)
    conn.commit()


# --------------------------------------------------------------------------- #
# Local GeoNames geocoder (offline; no external calls)
# --------------------------------------------------------------------------- #
_GAZETTEER = None  # lazy: normalized Cyrillic town -> (lat, lon, district)


def _norm_town(name):
    """Strip settlement prefixes/punctuation and lowercase for matching."""
    if not name:
        return ""
    s = name.strip()
    s = re.sub(r"^(гр\.?|с\.?|град|село|общ\.?|община)\s+", "", s, flags=re.IGNORECASE)
    s = re.sub(r"[\"'„“».,;:()]", "", s).strip()
    return s.lower()


def _load_gazetteer():
    """Cyrillic-name → (lat, lon, district) from GeoNames BG.txt, biggest town wins."""
    idx = {}
    with zipfile.ZipFile(GEONAMES_ZIP) as zf:
        text = zf.read(GEONAMES_MEMBER).decode("utf-8")
    for r in csv.reader(io.StringIO(text), delimiter="\t"):
        if len(r) < 15 or r[6] != "P":          # feature class P = populated place
            continue
        district = ADMIN1_TO_DISTRICT.get(r[10])
        if not district:
            continue
        try:
            lat, lon = float(r[4]), float(r[5])
        except ValueError:
            continue
        pop = int(r[14]) if r[14] else 0
        names = {r[1], r[2]}                      # name + asciiname
        for alt in r[3].split(","):              # Cyrillic alternate names only
            if any("Ѐ" <= ch <= "ӿ" for ch in alt):
                names.add(alt)
        for n in names:
            k = _norm_town(n)
            if k and (k not in idx or pop > idx[k][3]):
                idx[k] = (round(lat, 6), round(lon, 6), district, pop)
    log.info("gazetteer loaded: %d place names", len(idx))
    return idx


def geocode(*candidates):
    """First candidate town/text that matches the gazetteer → (lat, lon, district).

    Geocoding is best-effort enrichment: if the GeoNames gazetteer is missing or
    unreadable (e.g. ../datasets/BG.zip wasn't deployed — datasets/ is gitignored),
    we degrade to (None, None, None) so records are still cached without map coords,
    instead of letting the failure bubble up and discard the entire scraped batch.
    """
    global _GAZETTEER
    if _GAZETTEER is None:
        try:
            _GAZETTEER = _load_gazetteer()
        except Exception as exc:
            log.warning("gazetteer unavailable (%s) — caching records without coords", exc)
            _GAZETTEER = {}          # cache the failure: don't retry per record
    for cand in candidates:
        if not cand:
            continue
        hit = _GAZETTEER.get(_norm_town(cand))      # whole string is exactly a town
        if hit:
            return hit[0], hit[1], hit[2]
        # The execution-place field is usually a full address, not a bare town —
        # "гр. София, Район „Възраждане“, ул. „Брегалница“ 26". Pull out the
        # settlement-prefixed token (гр./с./общ. X) so we resolve the real town.
        # Anchoring on the prefix is what keeps this precise: scanning every word
        # instead would collide common words (Възраждане, Ректорат…) with tiny
        # like-named villages and geocode projects to the wrong province.
        for m in _PLACE_PREFIX_RE.finditer(cand):
            hit = _GAZETTEER.get(_norm_town(m.group(1)))
            if hit:
                return hit[0], hit[1], hit[2]
    return None, None, None


# Settlement-prefixed town token inside a free-text address/description:
# "гр. София", "с.Бояджик", "гр.Казанлък", "общ. Тунджа". The captured group is the
# town name (the prefix itself is stripped again by _norm_town before lookup).
_PLACE_PREFIX_RE = re.compile(
    r"\b(?:гр|с|град|село|общ|община)\.?\s*([А-ЯЀ-ӿ][А-Яа-яЀ-ӿ\-]{2,})", re.IGNORECASE)


# --------------------------------------------------------------------------- #
# Fetch
# --------------------------------------------------------------------------- #
_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT})


def _get(url, params=None):
    """GET → decoded cp1251 text, or None on failure (never raises)."""
    try:
        resp = _session.get(url, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        log.warning("fetch failed (%s): %s", url, exc)
        return None
    resp.encoding = RESPONSE_ENCODING
    return resp.text


def fetch_search(term):
    """Quick-search for one Bulgarian term (cp1251 url-encoded)."""
    q = quote(term.encode(RESPONSE_ENCODING))
    return _get(f"{AOP_SEARCH_URL}?mode=search&word={q}")


# --------------------------------------------------------------------------- #
# Parse — search results are vertical label:value blocks of <tr class="odd|even">
# --------------------------------------------------------------------------- #
_ID_RE = re.compile(r"[?&]id=(\d+)")


def parse_search(html):
    """Group result rows into records: {procurement_number, project_name, detail_url}."""
    if not html:
        return []
    records, cur = [], None
    try:
        soup = BeautifulSoup(html, "html.parser")
        for row in soup.select("tr.odd, tr.even"):
            cells = row.find_all("td")
            if len(cells) < 2:
                continue
            label = " ".join(cells[0].get_text(" ", strip=True).split())
            value = " ".join(cells[1].get_text(" ", strip=True).split())

            if label.startswith("Водещ документ"):
                if cur and cur.get("procurement_number"):
                    records.append(cur)
                cur = {"procurement_number": None, "project_name": "", "detail_url": None}
                link = cells[1].find("a")
                if link and link.get("href"):
                    cur["detail_url"] = urljoin(AOP_BASE, link["href"])
                    m = _ID_RE.search(link["href"])
                    if m:
                        cur["procurement_number"] = m.group(1)
                if not cur["procurement_number"]:           # fall back to the ( NNN ) id
                    m = re.search(r"\(\s*(\d+)\s*\)", value)
                    if m:
                        cur["procurement_number"] = m.group(1)
            elif cur is not None and label.startswith("Описание"):
                cur["project_name"] = value
        if cur and cur.get("procurement_number"):
            records.append(cur)
    except Exception as exc:                                # parsing must never crash
        log.warning("parse_search failed: %s", exc)
    return records


_BUYER_RE = re.compile(r"Официално наименование:\s*(.+?)\s*(?:Национален|Пощенски|Адрес|код NUTS|$)")
_PLACE_RE = re.compile(r"Основно място на изпълнение:\s*(.+?)\s*(?:II\.|Информация|Допълнителна|$)")


def parse_detail(html):
    """Pull (buyer, build_town) from a detail page's flattened text."""
    if not html:
        return None, None
    text = " ".join(re.sub(r"<[^>]+>", " ", html).split())
    buyer = m.group(1).strip()[:255] if (m := _BUYER_RE.search(text)) else None
    town = m.group(1).strip() if (m := _PLACE_RE.search(text)) else None
    return buyer, town


# --------------------------------------------------------------------------- #
# Filter + amenity mapping
# --------------------------------------------------------------------------- #
def classify(description):
    """English amenity_type if the text is a NEW civic build (action + target), else None."""
    if not description:
        return None
    text = description.lower()
    if not any(a in text for a in ACTION_KEYWORDS):
        return None
    for target, amenity in TARGET_AMENITY.items():
        if target in text:
            return amenity
    return None


# --------------------------------------------------------------------------- #
# Persist
# --------------------------------------------------------------------------- #
def upsert_records(records):
    """INSERT ... ON CONFLICT DO UPDATE (dedup by AOP id, backfilling coords).

    A plain DO NOTHING would permanently freeze the first values we ever cached —
    so any record first stored without coordinates (e.g. before the gazetteer was
    deployed, or when its detail page errored) could never be geocoded by a later
    re-scrape. We refresh on conflict instead, but COALESCE the enrichment fields
    so a re-scrape that *loses* a location never overwrites a previously-good one.
    """
    if not records:
        log.info("no records to persist")
        return 0
    values = [(
        r["procurement_number"][:50],
        (r.get("buyer_name") or "")[:255],
        r.get("project_name") or "",
        r["amenity_type"],
        r.get("lat"), r.get("lon"), r.get("district"),
    ) for r in records]

    try:
        with psycopg2.connect(**pg_dsn()) as conn:
            ensure_schema(conn)
            with conn.cursor() as cur:
                execute_values(cur, """
                    INSERT INTO planned_municipal_projects
                      (procurement_number, buyer_name, project_name, amenity_type, lat, lon, district)
                    VALUES %s
                    ON CONFLICT (procurement_number) DO UPDATE SET
                      project_name = EXCLUDED.project_name,
                      amenity_type = EXCLUDED.amenity_type,
                      buyer_name = COALESCE(EXCLUDED.buyer_name, planned_municipal_projects.buyer_name),
                      lat        = COALESCE(EXCLUDED.lat,        planned_municipal_projects.lat),
                      lon        = COALESCE(EXCLUDED.lon,        planned_municipal_projects.lon),
                      district   = COALESCE(EXCLUDED.district,   planned_municipal_projects.district)
                """, values, page_size=500)
            conn.commit()
    except psycopg2.Error as exc:
        log.error("DB write failed: %s", exc)
        return 0
    log.info("%d civic build(s) upserted (coords backfilled on conflict)", len(values))
    return len(values)


# --------------------------------------------------------------------------- #
# Job + scheduler
# --------------------------------------------------------------------------- #
def scrape_term(term):
    """Search one term → enrich each civic-build hit with buyer + geocoded location."""
    hits = parse_search(fetch_search(term))
    log.info("term %r → %d search result(s)", term, len(hits))
    out, seen = [], set()
    for h in hits:
        pid = h["procurement_number"]
        if pid in seen:
            continue
        seen.add(pid)
        if len(out) >= MAX_DETAILS_PER_TERM:
            break

        buyer, town = parse_detail(_get(h["detail_url"])) if h.get("detail_url") else (None, None)
        time.sleep(DETAIL_DELAY_SEC)
        # Classify on description + buyer (subject text is the strongest signal).
        amenity = classify(h.get("project_name", "")) or classify(buyer or "")
        if amenity is None:
            continue
        # Try the authoritative execution-place first, then the subject description
        # (it often names the town when the detail page errors), then the buyer.
        lat, lon, district = geocode(town, h.get("project_name", ""), buyer)
        out.append({
            "procurement_number": pid,
            "buyer_name": buyer,
            "project_name": h.get("project_name", ""),
            "amenity_type": amenity,
            "lat": lat, "lon": lon, "district": district,
        })
    return out


def run_scrape_job():
    """One end-to-end pass over every target term: fetch → parse → enrich → cache."""
    log.info("scrape job started")
    try:
        all_records, seen = [], set()
        for term in TARGET_AMENITY:
            for rec in scrape_term(term):
                if rec["procurement_number"] not in seen:
                    seen.add(rec["procurement_number"])
                    all_records.append(rec)
        geocoded = sum(1 for r in all_records if r["lat"] is not None)
        log.info("collected %d civic build(s); %d geocoded", len(all_records), geocoded)
        upsert_records(all_records)
    except Exception as exc:                     # a job must never kill the scheduler
        log.exception("scrape job crashed: %s", exc)
    log.info("scrape job finished")


def main():
    # --once: run a single pass and exit (used by the admin "force scrape" button,
    # which shells out to this script on demand instead of waiting for the schedule).
    if "--once" in sys.argv:
        log.info("single-shot mode (--once): one pass then exit")
        run_scrape_job()
        return
    run_scrape_job()                             # immediate run so it's testable now
    scheduler = BlockingScheduler()
    scheduler.add_job(run_scrape_job, "interval", weeks=2, id="aop_biweekly")
    log.info("scheduler armed: bi-weekly (every 2 weeks). Ctrl-C to stop.")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("scheduler stopped")


if __name__ == "__main__":
    main()
