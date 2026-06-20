# Methodology — The Math of Lost Time

This is the precise definition of every number the app reports: the cohorts, the travel
model, the scoring formulas, and the assumptions behind them. Where a constant is named,
its source file is given so the numbers stay traceable.

## Cohorts (demand groups)

Two groups, each served by a fixed set of amenity types:

| Group key | Population | Served by |
| :--- | :--- | :--- |
| `children_0_6` | children aged 0–6 | `kindergarten`, `school` |
| `seniors_65p` | seniors aged 65+ | `hospital`, `clinic`, `pharmacy` |

The group ↔ service mapping is defined identically in three places that must stay in sync:
`TimePovertyService.GROUP_SERVICES` (backend), `sim.GROUP_SERVICES` (ml-service), and
`AMENITY_MAP` (`data-engine/config.py`).

### Cohort age-band math

NSI reports population in 5-year bands. The cohorts are folded from those bands
(`data-engine/config.py`):

- **`children_0_6`** = age `0` + band `1–4` + **⅖** of band `5–9`
  (`CHILD_BANDS = {"0": 1.0, "1 - 4": 1.0, "5 - 9": 0.4}`). The ⅖ factor approximates ages
  5 and 6 by assuming a uniform spread of single years within the 5–9 band.
- **`seniors_65p`** = sum of all bands `65–69 … 100+` (`SENIOR_BANDS`).

## Travel time

The baseline travel model is a flat walking/local-mobility proxy:

```
oneWayMinutes = haversine_km / SPEED_KMH × 60        (SPEED_KMH = 4.5)
```

- `haversine_km` uses Earth radius **6371.0088 km** (`GeoUtil` in the backend,
  `_haversine_vec` in the ml-service — they agree).
- `SPEED_KMH = 4.5` is a deliberate **lower bound**: a walking / local-mobility speed,
  set by `app.geo.assumed-speed-kmh` (backend `application.yml`) and `ASSUMED_SPEED_KMH`
  (`data-engine/config.py`, env-overridable via `TPM_SPEED_KMH`).

A cell's travel time is the **minimum** over all serving nodes — the nearest facility wins:

```
nearestMinutes(cell) = min over serving nodes of  travelMinutes(haversine(cell, node))
```

> The **ml-service** replaces this flat proxy with a *learned* travel-time model
> (`traveltime.pkl`, monotonic in distance, R² 0.95) for its placement scoring. The Java
> backend uses the flat proxy. See [ml-service.md](ml-service.md).

## Visit frequency

How often each cohort makes a round trip drives the wasted-hours total. Two different
cadence tables exist for two different questions:

**Systemic / annual math** (`VISITS_PER_YEAR`, used by `/matrix` and `/simulate`):

| Group | Round trips / year |
| :--- | :--- |
| `children_0_6` | **180** |
| `seniors_65p` | **24** |

**Personal planner, per-amenity** (`SERVICE_VISITS` in `TimePovertyService`, used by
`/personal-compare` when fine-grained needs are supplied):

| Amenity | Round trips / year |
| :--- | :--- |
| kindergarten | 380 |
| school | 380 |
| clinic | 18 |
| hospital | 6 |
| pharmacy | 30 |

The annual figures and the per-amenity figures answer different questions (systemic
province-wide loss vs. one household's chosen services), so they are intentionally
separate tables.

## Scoring formulas

### Time-poverty score (severity)

```
timePovertyScore = nearestMinutes × population
```

A raw severity weight per cell — how many person-minutes of distance the cell suffers.

### Annual wasted hours (the headline metric)

```
annualWastedHours = (oneWayMinutes × 2 × visitsPerYear[group] × population) / 60
```

`× 2` makes each visit a round trip; `/ 60` converts minutes to hours. Summed over all
cells this is `totalAnnualWastedHours` for the requested scope — ≈ 14.5M hours/year for the
pilot province Stara Zagora (its own 126 nodes), and ≈ 334M hours/year for the whole country
(`district=all`, all 28 provinces against all 2,772 nodes).

> The nationwide total is **not** the sum of the per-province numbers: a single-province
> query only sees that province's own nodes, so border cells can't reach a nearer facility
> just over the line. The `district=all` view evaluates every cell against every node, which
> is the figure to quote for the country as a whole.

### Simulation — hours saved

Placing a hypothetical facility at `(lat, lon)` recomputes each cell's time as
`after = min(before, travelMinutes(distance to new node))`. A cell "improves" only when
`after < before`. The ROI reported is:

```
annualWastedHoursSaved = Σ over improved cells [ annualHours(before) − annualHours(after) ]
```

plus `affectedCells`, `peopleImpacted` (sum of improved-cell population), and
`minutesSavedPerTripAvg` (mean one-way reduction).

### Personal planner — weekly time-tax

The personal planner annualizes down to a single week. For a coarse group:

```
weeklyHours = (oneWayMinutes × 2 × (visitsPerYear[group] / 52)) / 60
```

For a fine-grained per-amenity need it uses the same shape with the per-amenity cadence:

```
weeklyHours = (oneWayMinutes × 2 × (SERVICE_VISITS[amenity] / 52)) / 60
```

The comparison reports `currentWeeklyHours`, `prospectiveWeeklyHours`, and
`efficiencyShiftHours = current − prospective` (positive ⇒ the move returns hours).

## Key assumptions

- **Urban vs. rural.** A settlement is *urban* (gets the NSI town age-share) if it is an
  administrative seat (`PPLC/PPLA/PPLA2/PPLA3`) or has population ≥ 2,000
  (`URBAN_POP_THRESHOLD`); otherwise *rural* (village age-share).
- **Village weighting.** ~6,900 small villages have no GeoNames population, so a province's
  rural cohort total is spread across them with a uniform relative weight
  (`VILLAGE_DEFAULT_WEIGHT = 250`). Only the ratio matters — totals are normalized back to
  the official NSI provincial totals.
- **Distance, not roads.** Travel time is straight-line (haversine) at a flat speed, not
  road routing. This is a deliberate lower-bound proxy; the ml-service can swap in real
  OpenRouteService routing when an API key is provided.

## Where the constants live

| Constant | Value | Defined in |
| :--- | :--- | :--- |
| Walking speed | 4.5 km/h | `application.yml` · `config.py` (`TPM_SPEED_KMH`) |
| Visits/yr (children) | 180 | `application.yml` · `config.py` |
| Visits/yr (seniors) | 24 | `application.yml` · `config.py` |
| Per-amenity visits/yr | 380/380/18/6/30 | `TimePovertyService.SERVICE_VISITS` |
| Earth radius | 6371.0088 km | `GeoUtil` · `sim._haversine_vec` |
| Urban pop threshold | 2,000 | `config.py` |
| Village weight | 250 | `config.py` |
