# API Reference

Two local services. The **backend** (`:8080`) owns the DB-backed matrix math; the
**ml-service** (`:8000`) serves the trained AI models. Both allow CORS from
`http://localhost:5500` and `http://127.0.0.1:5500`.

- Backend base: `http://localhost:8080/api/v1/time-poverty`
- ML base: `http://localhost:8000`

---

## Backend — `GET /matrix`

Baseline systemic time loss plus all nodes/cells for a district.

**Query params**

| Param | Default | Notes |
| :--- | :--- | :--- |
| `district` | `Pazardzhik` | Latin province name, or `all` / `All Bulgaria` for nationwide |

```bash
curl "http://localhost:8080/api/v1/time-poverty/matrix?district=Pazardzhik"
```

**Response** (`MatrixResponse`)

```jsonc
{
  "district": "Pazardzhik",
  "totalAnnualWastedHours": 9214233.0,
  "nodes": [
    { "serviceType": "kindergarten", "name": "...", "lat": 42.19, "lon": 24.33 }
  ],
  "cells": [
    {
      "cellId": "...", "settlement": "...", "groupKey": "children_0_6",
      "lat": 42.2, "lon": 24.3, "population": 145,
      "nearestMinutes": 38.4,
      "timePovertyScore": 5568.0,        // nearestMinutes × population
      "annualWastedHours": 33408.0
    }
  ]
}
```

---

## Backend — `POST /simulate`

Simulate placing a new facility; returns the annual wasted hours it would save.

**Body** (`SimulationRequest`)

```jsonc
{
  "district": "Pazardzhik",
  "lat": 42.05, "lon": 24.10,
  "amenityType": "kindergarten"   // kindergarten|school|hospital|clinic|pharmacy
}
```

```bash
curl -X POST http://localhost:8080/api/v1/time-poverty/simulate \
  -H 'Content-Type: application/json' \
  -d '{"district":"Pazardzhik","lat":42.05,"lon":24.10,"amenityType":"kindergarten"}'
```

**Response** (`SimulationResponse`)

```jsonc
{
  "amenityType": "kindergarten",
  "affectedGroup": "children_0_6",
  "affectedCells": 12,
  "peopleImpacted": 1840,
  "minutesSavedPerTripAvg": 14.2,
  "annualWastedHoursSaved": 220150.0,
  "deltas": [
    { "cellId": "...", "lat": 42.0, "lon": 24.1, "population": 145,
      "beforeMinutes": 38.4, "afterMinutes": 12.1, "hoursSavedAnnual": 22890.0 }
  ]
}
```

---

## Backend — `POST /personal-compare`

Compare weekly commute time-tax between a current and a prospective home. Evaluated against
all nodes nationwide (no district in the payload).

**Body** (`PersonalCompareRequest`). `householdProfile.needs` (fine-grained, preferred)
takes precedence over the legacy `hasChildren` / `needsSeniorCare` flags.

```jsonc
{
  "currentLat": 42.20, "currentLon": 24.30,
  "prospectiveLat": 42.19, "prospectiveLon": 24.34,
  "householdProfile": {
    "needs": ["kindergarten", "clinic", "pharmacy"],   // preferred
    "hasChildren": true, "needsSeniorCare": false       // legacy fallback
  }
}
```

```bash
curl -X POST http://localhost:8080/api/v1/time-poverty/personal-compare \
  -H 'Content-Type: application/json' \
  -d '{"currentLat":42.20,"currentLon":24.30,"prospectiveLat":42.19,"prospectiveLon":24.34,"householdProfile":{"needs":["kindergarten","clinic","pharmacy"]}}'
```

**Response** (`PersonalCompareResponse`)

```jsonc
{
  "currentWeeklyHours": 6.8,
  "prospectiveWeeklyHours": 4.1,
  "efficiencyShiftHours": 2.7,   // current − prospective; > 0 ⇒ hours returned
  "gain": true,
  "currentBreakdown": [
    { "group": "kindergarten", "label": "Kindergarten",
      "nearestMinutes": 18.0, "weeklyHours": 4.4 }
  ],
  "prospectiveBreakdown": [ /* same shape */ ]
}
```

In fine-grained mode each breakdown entry's `group` carries the **service type** (so the UI
can colour it); in legacy mode it carries the cohort group (`children_0_6` / `seniors_65p`).

---

## ML — `GET /health`

```bash
curl http://localhost:8000/health
```

```jsonc
{ "status": "ok", "settlements": 349, "nodes": 2772,
  "amenities": ["clinic", "kindergarten"], "groups": ["children_0_6", "seniors_65p"] }
```

---

## ML — `POST /api/ml/traveltime`

Learned travel-time prediction (monotonic in distance).

**Body** (`TravelReq`)

```jsonc
{ "km": 12, "is_urban": 0, "dest_density": 1 }
```

```bash
curl -X POST http://localhost:8000/api/ml/traveltime \
  -H 'Content-Type: application/json' -d '{"km":12,"is_urban":0,"dest_density":1}'
# → {"minutes": 30.1}
```

---

## ML — `GET /api/ml/recommend`

Top-N highest-impact build sites from the placement model.

**Query params**

| Param | Default | Notes |
| :--- | :--- | :--- |
| `amenity` | `kindergarten` | `kindergarten`/`school` → children model; `clinic`/`hospital`/`pharmacy` → seniors model |
| `district` | _(none)_ | Latin province name, or omit / `all` for national |
| `top` | 3 | number of sites returned |
| `grid` | 40 | candidate grid resolution (grid × grid) |
| `min_separation_km` | 8.0 | NMS spacing so sites aren't clustered |

```bash
curl "http://localhost:8000/api/ml/recommend?amenity=kindergarten&district=Pazardzhik&top=3"
```

**Response**

```jsonc
{
  "district": "Pazardzhik", "amenity": "kindergarten", "group": "children_0_6",
  "recommendations": [
    { "lat": 42.05, "lon": 24.11, "nearestTown": "Velichkovo", "predictedHoursSaved": 218400 }
  ]
}
```

An unknown amenity returns `{ "error": ..., "available": [...] }`; an unknown district
returns `{ "error": "unknown district '...'" }`.

---

## Quick verification

```bash
curl "http://localhost:8080/api/v1/time-poverty/matrix?district=Pazardzhik" | head -c 200
curl "http://localhost:8000/api/ml/recommend?amenity=kindergarten&top=3"
curl http://localhost:8000/health
```
