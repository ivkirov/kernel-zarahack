# Overview — What the Time Poverty Matrix Is

## The problem: an invisible "time tax"

When a kindergarten, school, clinic, or hospital is far away, the distance is paid
back in **time** — by the people least able to spare it. A parent of a toddler in a
remote Rhodope village can lose hours every week just getting to the nearest
kindergarten; a senior without a clinic nearby pays the same tax for every check-up.
This cost is real but invisible: it never shows up on a budget line, so infrastructure
planning rarely accounts for it.

The **Time Poverty Matrix** makes that cost visible. It quantifies the hours that
infrastructure gaps steal from vulnerable populations across Bulgaria, and renders the
result on an interactive map so the worst "deserts" — and the highest-impact fixes —
are obvious at a glance.

## Who it measures

The project focuses on the two groups most exposed to the time tax, because they travel
to essential services often and have the least flexibility:

| Cohort | Key | Services that serve it |
| :--- | :--- | :--- |
| **Children 0–6** | `children_0_6` | kindergartens, schools |
| **Seniors 65+** | `seniors_65p` | clinics, hospitals, pharmacies |

## What it produces

For every settlement and cohort, the system computes:

- **`nearestMinutes`** — one-way travel time to the closest serving facility.
- **`timePovertyScore`** = `nearestMinutes × population` — the raw severity of the gap.
- **`annualWastedHours`** — round-trip time × visit frequency × population, in hours/year.

Summed over a province (or the whole country) this gives a single, headline number:
the **annual wasted hours** a population loses to infrastructure distance. Across all 28
provinces that figure is roughly **334 million hours/year**; the pilot single-province
view (Stara Zagora) accounts for roughly **14.5 million hours/year** of it. The app boots into
the nationwide `All Bulgaria` view (`district=all`); pick any single province from the picker
to drill in.

## The three lenses plus an AI recommender

The app presents a login gate, then a **role-aware** landing portal — each account sees
only the lens(es) its role/tier allows:

- **🏛 Municipal Infrastructure Optimization** *(municipality tier)* — see systemic time-loss
  across a province, **click the map** to simulate building a facility and watch the annual
  "wasted hours saved", or press **AI: Recommend best sites** to have a trained model propose
  the highest-impact locations.
- **🏠 Personal Relocation Planner** *(free / paid tier)* — drop two pins (current vs.
  prospective home) and compare your weekly commute time-tax, broken down by the services
  your household uses. Free accounts are limited (3 checks, a fixed filter set); the paid
  tier adds an AI explanation and area suggestions.
- **📡 Accountability Radar** *(reporter tier)* — planned civic builds scraped from the AOP
  procurement registry, audited against the model's optimal sites.

Accounts, roles and paid tiers gate all of this; paid access is **admin-assigned**. The
**AI recommender** is a separate Python service hosting models trained on the project's own
real data — it suggests where new facilities would return the most hours.

## Built on real open data

Nothing here is synthetic. The supply side (where facilities are) comes from
**OpenStreetMap**; the demand side (who needs them, and where) is a fusion of the
**NSI census** (population by province × age × urban/rural) and **GeoNames** (every
settlement's coordinates). The pipeline covers **all 28 Bulgarian provinces** —
**2,772** supply nodes and **14,476** demand cells.

## How the pieces fit

| Subsystem | Role | Deep dive |
| :--- | :--- | :--- |
| `data-engine/` | one-time ETL that fuses the datasets and seeds PostgreSQL | [data-pipeline.md](data-pipeline.md) · [datasets.md](datasets.md) |
| `backend-api/` | Java/Spring REST API: matrix, simulate, personal, Radar + accounts/roles/JWT auth | [backend-api.md](backend-api.md) |
| `ml-service/` | Python/FastAPI AI sidecar: placement + travel-time models | [ml-service.md](ml-service.md) |
| `frontend/` | Tailwind + Leaflet dashboard, login gate + role-aware lenses | [frontend.md](frontend.md) |

The math behind every number lives in [methodology.md](methodology.md); the system
shape is in [architecture.md](architecture.md); how to run it is in
[getting-started.md](getting-started.md); and every endpoint is catalogued in
[api-reference.md](api-reference.md).
