# ZaraHack 2026 — Project Submission (HACKATHON.md)

**Project: Reclaim — *The Geography of Lost Time***

- **Live demo:** https://7001-p-32aa65e3db37.vs2.openkbs.com/
- **Source code:** https://github.com/ivkirov/kernel-zarahack
- **Deeper docs:** [`README.md`](README.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`docs/`](docs/) · [`SECURITY.md`](SECURITY.md)

---

## 1. Team

- **Team name:** Kernel Crushers
- **Members (name — what each person did):**
  - **Dimitar Kirichev** — full-stack. Worked across the Java/Spring backend, the Python ML service + data ETL, the Leaflet frontend, and the security hardening.
  - **Ivaylo Kirov** — full-stack. Worked across the same surfaces: backend, ML/data, frontend, and the GitHub auto-deploy.
- **How did you split the tasks? Who did what?:** We're both full-stack, so we split the work evenly rather than by "frontend person / backend person" — each of us owned features end-to-end across all four services. We **debate every design choice** (new features, data models, the scoring formulas) before writing code, **test before every push**, and we're constantly bug-hunting each other's work.

---

## 2. What Problem Are You Solving?

**Time poverty** — the invisible "time tax" people pay when essential services are far from where they live. It hits two groups the hardest because their trips are *recurring and mandatory*: **families with children 0–6** (daily kindergarten/school runs) and **seniors 65+** (clinics, hospitals, pharmacies). A parent driving 40 minutes each way to the nearest kindergarten loses **hundreds of hours a year**. Municipal planners feel it too — they don't have a clear, data-backed answer to *"where should we build to give people the most time back?"* — and citizens can't easily tell whether public money is being spent in the right places. Across Bulgaria's 28 provinces this adds up to **≈ 334 million wasted hours per year**.

---

## 3. How Do You Solve It? (in plain language)

When the nearest kindergarten, doctor, or pharmacy is far away, you spend a big chunk of your life just *getting there and back* — and that time is gone for good. Our map shows, town by town across Bulgaria, how many hours people lose to that travel. A family thinking about moving can drop two pins — their current home and a possible new one — and instantly see which one steals less of their week. A town hall can tap anywhere on the map to ask *"if we built a clinic here, how many hours would we hand back to people?"* And anyone can check whether the government is actually building new facilities in the places that need them most.

---

## 4. What Technologies Do You Use?

- **Languages:** Java 25, Python 3.11+, JavaScript (vanilla), SQL.
- **Frontend:** static HTML + vanilla JS (no framework), Tailwind CSS v3.4, Leaflet.js (interactive map), GSAP (animation), a tiny custom i18n layer (Bulgarian + English), served by `live-server`.
- **Backend (`backend-api`):** Java 25 / **Spring Boot 4.1**, Spring Data JPA. **Dependency-free auth** we wrote ourselves: PBKDF2-HMAC-SHA256 password hashing + a hand-rolled HS256 JWT + a servlet filter (no Spring Security needed).
- **ML service (`ml-service`):** Python / **FastAPI**, **XGBoost** + **scikit-learn**, NumPy, pandas, joblib, uvicorn.
- **Data engine (`data-engine`):** Python ETL — `osmium` (OSM `.pbf`), pandas/openpyxl (NSI Excel), GeoNames; plus a live `aop.bg` procurement scraper (`requests` + `BeautifulSoup` + `APScheduler`); `psycopg2`.
- **Database:** PostgreSQL.
- **External data/APIs:** OpenStreetMap (Geofabrik), NSI Infostat (national statistics), GeoNames, `aop.bg` (public-procurement registry); **Google Gemini** for the AI write-ups (live in the demo); *optional* OpenRouteService for real routed travel times.
- **Hosting / deployment:** GitHub Actions **self-hosted runner** → VM, idempotent bash deploy scripts (`scripts/deploy.sh`), behind the OpenKBS proxy.

---

## 5. How Do You Wire Them Together?

Four independent services that each do one job, talking over HTTP and SQL:

```
 OpenStreetMap ─┐
 NSI census    ─┤→ [Python data-engine ETL] → [PostgreSQL] ←─ [aop.bg scraper]
 GeoNames      ─┘                                  │
                                                   ▼
                                          [Java Spring API :8080]  ── auth, roles,
                                          deterministic "physics" math, caching
                                                   │
                            REST ┌──────────────────┴───────────────┐ REST
                                 ▼                                   ▼
                    [vanilla-JS + Leaflet frontend :5500/7001]   [Python FastAPI ML :8000]
                       the map the user actually sees      ←──    travel-time + placement models
```

Raw open data is fused by the **Python ETL** into Postgres. The **Java backend** owns the deterministic math (distance → travel minutes → wasted hours), accounts, roles and caching. The **Python ML service** serves the two trained models and is *dataset-free at runtime* (it loads small cached CSVs, so it boots without the database). The **frontend** calls the Java API for the map/auth and the ML service for AI recommendations, and overlays everything on Leaflet. Java and Python deliberately **share the exact same formula and constants** so their numbers always agree.

---

## 6. Do You Train an ML Model?

**Yes — two model families, both trained offline against the real OSM geography + NSI×GeoNames demand, served by FastAPI.**

- **What they do:**
  1. **Travel-time model** — predicts one-way **travel minutes** from a trip's straight-line distance, an urban/rural flag, and how dense services are around the destination (so city trips are faster than rural ones).
  2. **Placement model** — predicts **how many annual hours a brand-new facility at a given spot would save** the whole region, so we can score thousands of candidate locations instantly.
- **Base model / starting point:**
  1. scikit-learn **`HistGradientBoostingRegressor`** (gradient-boosted trees) with a **monotonic constraint** forcing time to be non-decreasing in distance.
  2. **`XGBoost` `XGBRegressor`** (with a graceful fallback to scikit-learn `GradientBoostingRegressor` if XGBoost isn't installed). Two per-cohort models (children vs seniors).
- **How we train them:** The placement model's labels are **not invented** — we lay a 44×44 grid over Bulgaria and, at *each* grid point, run the **real vectorized simulation** (recompute every demand cell's nearest-facility time assuming the new facility exists, sum the hours saved). That sum is the ground-truth label. Features are deliberately **location-free and demand-aware** (e.g. cohort population within 5/15 km, distance to the nearest existing service, currently-addressable wasted hours within 10/25 km) so the model generalizes from the *situation* around a point, not memorized coordinates. The travel-time model trains on a physics-based speed curve (or real OpenRouteService routes when `ORS_API_KEY` is set).
- **How we check accuracy:** 80/20 **train/test split** (`random_state=42`), reporting **MAE** (hours / minutes) and **R²** on the held-out set. The travel model additionally runs a **monotonicity self-check** on a dense distance sweep and a "km = 0 ≈ 0 min" sanity check (fixing a classic tree artifact where a service next door wrongly predicts ~8 min).

---

## 7. What Datasets Do You Use, and How?

All core layers are **real Bulgarian open data — no synthetic placeholders.**

**1. OpenStreetMap — *supply*** (where facilities physically are)
- Source: https://download.geofabrik.de/europe/bulgaria.html (Geofabrik / OSM). Licence: ODbL.
- Why: the most complete, current, openly-licensed map of facilities.
- What we did: parsed the `.osm.pbf` with `osmium`, kept `kindergarten / school / hospital / clinic / doctors / pharmacy`, normalized to a `service_type`, deduplicated → **2,772 supply nodes**.

**2. NSI Infostat — *demand magnitude*** (how many people, per cohort, per province)
- Source: https://infostat.nsi.bg/ (Bulgaria's National Statistical Institute). Licence: open government data.
- Why: the authoritative count of population by province × age band × urban/rural.
- What we did: folded the 5-year age bands into our two cohorts (**children 0–6**, **seniors 65+**) and distributed each province total across its real towns.

**3. GeoNames — *the spatial glue*** (coordinates + size per settlement)
- Source: https://download.geonames.org/export/dump/ (`BG.zip`). Licence: CC BY 4.0.
- Why: NSI gives counts per province but no coordinates; GeoNames gives lat/lon + population per settlement, so we can turn province totals into **point-located demand** (→ **14,476 demand cells**) and geocode scraped procurement towns *offline*.

**4. geoBoundaries (ADM2) + GADM — *map boundaries / geofence***
- Sources: https://www.geoboundaries.org/ · https://gadm.org/. Licences: open / CC BY.
- What we did: municipal borders + the country outline used for the click-geofence and pan-clamping.

**5. aop.bg — *public-procurement registry*** (planned civic builds, for the Accountability Radar)
- Source: https://www.aop.bg/. Public registry.
- What we did: live-scrape planned school/kindergarten/clinic builds, classify "new build", geocode the build town offline against GeoNames, dedupe, and cache in Postgres.

**Integrity & ethics:** Three systems name provinces three different ways (NSI Cyrillic, GeoNames numeric codes, app Latin), so we built **one authoritative crosswalk** that — crucially — keeps **София-столица (the capital)** and **София-област (the surrounding province)** as two distinct entities, which a naïve name-match would silently merge and corrupt. The scraper is polite (rate-limited + an immediate-then-bi-weekly cadence + dedup) and only reads public pages.

---

## 8. How Will the Platform Scale?

It's built as **four small, independent services + Postgres**, so each tier scales on its own. Reads are cached on both sides (the heavy province "matrix" is cached server-side *and* client-side, keyed by a bounded set of provinces), and the **ML service is dataset-free at runtime**, so it boots without the DB and can simply be replicated behind a load balancer. The product is **data-driven, not Bulgaria-coded** — point the ETL at another country's OSM + census + GeoNames extract and the same models retrain, so going global is a data swap, not a rewrite. Under a sudden 10,000 users the first things to strain would be the single Postgres instance and the in-process cache; the fix is a read replica + a shared cache (Redis/CDN) and moving the heaviest ML grid-search behind a queue. We've already **clamped the expensive ML search and rate-limited auth** so a spike (or an attacker) can't take it down.

---

## 9. What Challenges Did You Face?

- **One number, three spellings.** Fusing OSM + NSI + GeoNames meant reconciling province names across Cyrillic, numeric admin codes, and Latin — and the two "Sofias" quietly merging would have wrecked the demand math. We solved it with a single authoritative province crosswalk and verified the totals.
- **Scoring thousands of sites in real time.** Running the full simulation for every candidate build location is far too slow for an interactive map, so we trained an **XGBoost surrogate** on labels generated by the *real* simulation — instant scoring for a small, measured accuracy loss.
- **A registry from the pre-UTF-8 era.** `aop.bg` has no API and serves Windows-1251 HTML, so we reverse-engineered its search + detail pages, decoded them correctly, and geocode build towns **offline** against GeoNames so the Radar works air-gapped.
- **Security.** We ran a full **OWASP pass** and fixed real issues we found in our own code (auth-token handling, output escaping/XSS, denial-of-service limits) — written up in [`SECURITY.md`](SECURITY.md).

---

## 10. Did You Check What Already Exists?

Yes. The closest neighbors are **"15-minute city" / accessibility studies** and **isochrone tools** (e.g. OpenRouteService / Mapbox reachability maps): they measure *how far* services are, but they're usually generic routing or one-off academic reports, not tied to *who* lives there or to public spending. Bulgaria also has open-data portals, but they publish raw tables, not an actionable metric. Our twist is the combination none of them do together: (1) we convert access into a concrete, human number — **annual hours lost per cohort**; (2) we let municipalities **simulate a build and get ML-recommended sites**; and (3) the **Accountability Radar** cross-references *real planned procurement spending* against the model's optimal locations to flag misallocated money. We haven't found an existing tool that closes that loop from demographic demand → optimal placement → auditing actual spending.

---

## 11. Where Did You Use AI, and What's Not Yours?

- **AI tools used (and for what):** AI coding assistants (incl. Claude) for debugging, code review, and an OWASP security-hardening pass. *All* architecture, data-fusion, scoring-formula and product decisions are ours; the AI helped us move faster and catch bugs, it didn't design the project.
- **AI at runtime:** Google **Gemini** generates the natural-language explanations (the "is this a good place to build?" / "why this area suits you" write-ups). **The live demo is configured with a Gemini key, so those are real, live LLM output.** A deterministic templated narrative is the built-in fallback if the key is missing or a call fails/times out, so the feature never breaks.
- **Third-party code / libraries (and their licences):**
  - Frontend: **Leaflet** (BSD-2-Clause), **GSAP** (GreenSock standard "no-charge" licence), **Tailwind CSS** (MIT) — CDN libs are version-pinned with Subresource Integrity.
  - Backend: **Spring Boot** (Apache-2.0), **PostgreSQL JDBC** (BSD-2).
  - ML/data: **XGBoost** (Apache-2.0), **scikit-learn / pandas / NumPy** (BSD-3-Clause), **FastAPI** (MIT), **uvicorn** (BSD), **BeautifulSoup4 / APScheduler** (MIT), **psycopg2** (LGPL-3.0), **pyosmium** (BSD).
  - Data: OpenStreetMap (ODbL), NSI open data, GeoNames (CC BY 4.0), geoBoundaries/GADM (open/CC BY).
- No paid templates or copied project boilerplate — the app code is ours.

---

## 12. Honesty Box

- **Travel-time labels are physics-synthetic by default** (a realistic urban-42 / rural-24 km/h curve with noise), *not* real routed times — unless `ORS_API_KEY` is set, in which case it trains on real OpenRouteService routes. The seam to swap in real data is one env var.
- **The AI explanations in the live demo are real Gemini** (the deployment has a `GEMINI_API_KEY` set). We keep a deterministic templated narrative as a fallback for when there's no key or a call fails/times out, so the feature still works offline — but the public demo is genuine live LLM output.
- **The placement model is a surrogate** of the full simulation — it trades a small, *reported* accuracy loss (MAE/R²) for the ability to score thousands of candidates instantly.
- **The payment / paywall is a stand-in.** Clicking "pay" just activates the tier in-app — there's **no real payment processor wired up yet**. (Roles can also be granted by an admin.)
- **Demand distribution** assumes each cohort's share is roughly uniform within a province (we spread province totals by town population).
- **Coverage is only as good as OSM tagging** — a handful of facilities may be missing or mistagged; and procurement geocoding resolves to the **build town**, not an exact street address, so very granular intra-city placement isn't distinguished and a few ambiguous records may stay ungeocoded.
- **Not part of the live stack:** the OpenKBS `functions/` and `site/` folders are a leftover dev playground; the real app is the four services above.
- Currently **Bulgaria-only** (by design for the hackathon) — the architecture is built to go global, but other countries aren't loaded yet.

---

*Built with real open data for ZaraHack 2026. See [`SECURITY.md`](SECURITY.md) for our threat model and hardening, and [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full technical story.*
