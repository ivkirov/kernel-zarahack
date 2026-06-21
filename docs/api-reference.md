# API Reference

Two local services. The **backend** (`:8080`) owns the DB-backed matrix math plus
accounts/roles; the **ml-service** (`:8000`) serves the trained AI models. Both allow CORS
from `http://localhost:5500` and `http://127.0.0.1:5500`.

- Backend base: `http://localhost:8080/api/v1/time-poverty`
- Auth base: `http://localhost:8080/api/v1/auth`
- Admin base: `http://localhost:8080/api/v1/admin`
- ML base: `http://localhost:8000`

> **Every `/time-poverty/*` and `/admin/*` endpoint requires authentication** — send the
> JWT from login/register as `Authorization: Bearer <token>`. The ML service (`:8000`) is
> not authenticated. Auth/role failures return a JSON body `{ "code", "message" }` the
> frontend keys paywall/login UX on (codes: `UNAUTHENTICATED` 401; `ACCESS_MUNICIPAL` /
> `ACCESS_REPORTER` / `ACCESS_PERSONAL` 403; `PAYWALL_FILTER` / `PAYWALL_QUOTA` /
> `PAYWALL_UPGRADE` 402).

---

## Auth — `POST /auth/register`, `POST /auth/login`

Register a new account or sign in. Both return a JWT + the account view. On register the
`persona` picks the role: `individual` → `FREE_USER` (usable immediately); `reporter` /
`municipality` → that role but **locked** until an admin grants access. Payments are
admin-assigned — there is no self-serve upgrade.

```bash
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"secret1","displayName":"Me","persona":"individual"}'

curl -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"secret1"}'
```

**Response** (`AuthResponse`)

```jsonc
{
  "token": "<JWT>",
  "user": {
    "id": 2, "email": "me@example.com", "displayName": "Me",
    "role": "FREE_USER",          // ADMIN|FREE_USER|PAID_USER|REPORTER|MUNICIPALITY
    "accessGranted": true,        // paid access activated by an admin
    "active": true,               // usable now (free/admin, or a granted paid tier)
    "freeGuessesUsed": 0, "freeGuessLimit": 3,
    "freeGuessesRemaining": 3     // null = unlimited (paid/admin)
  }
}
```

## Auth — `GET /auth/me`

Returns the current `UserView` (above). Used by the frontend to bootstrap role-aware UI.

```bash
curl http://localhost:8080/api/v1/auth/me -H "Authorization: Bearer $TOKEN"
```

---

## Admin — `GET /admin/users`, `PATCH /admin/users/{id}` *(ADMIN only)*

List accounts, or change an account's role / grant paid access. `ADMIN` cannot be assigned
and the seeded admin row cannot be edited — both are **enforced server-side** in
`UserAdminService` (`403 ADMIN_FORBIDDEN` / `ADMIN_IMMUTABLE`), not merely hidden in the UI.
There is exactly one admin, seeded from `APP_ADMIN_*`.

```bash
curl http://localhost:8080/api/v1/admin/users -H "Authorization: Bearer $ADMIN_TOKEN"

curl -X PATCH http://localhost:8080/api/v1/admin/users/3 \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"role":"REPORTER","accessGranted":true}'   # both fields optional
```

---

## Backend — `GET /matrix`

Baseline systemic time loss plus all nodes/cells for a district.

**Query params**

| Param | Default | Notes |
| :--- | :--- | :--- |
| `district` | `Stara Zagora` | Latin province name, or `all` / `All Bulgaria` for nationwide |

```bash
curl "http://localhost:8080/api/v1/time-poverty/matrix?district=Stara%20Zagora"
# nationwide (all 28 provinces, ~334M totalAnnualWastedHours):
curl "http://localhost:8080/api/v1/time-poverty/matrix?district=all"
```

**Response** (`MatrixResponse`) — the example below is the `Stara Zagora` slice; `district=all`
returns the same shape with ~2,772 nodes, ~14,476 cells and `totalAnnualWastedHours` ≈ 334M.

```jsonc
{
  "district": "Stara Zagora",
  "totalAnnualWastedHours": 14513636.0,
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
  "district": "Stara Zagora",
  "lat": 42.20, "lon": 25.33,
  "amenityType": "kindergarten"   // kindergarten|school|hospital|clinic|pharmacy
}
```

```bash
curl -X POST http://localhost:8080/api/v1/time-poverty/simulate \
  -H 'Content-Type: application/json' \
  -d '{"district":"Stara Zagora","lat":42.20,"lon":25.33,"amenityType":"kindergarten"}'
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
all nodes nationwide (no district in the payload). **Role-gated:** `FREE_USER` /
`PAID_USER` / `ADMIN`. Free accounts are limited to **3 checks** (`PAYWALL_QUOTA`) and may
only request the allowed amenities `school`, `clinic`, `hospital`, `pharmacy`
(`PAYWALL_FILTER` otherwise); paid/admin also receive the `aiExplanation`.

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
  "prospectiveBreakdown": [ /* same shape */ ],
  "aiExplanation": "Moving to the prospective home would return …",  // paid/admin only; null for free
  "freeGuessesRemaining": 2          // free accounts only; null = unlimited (paid/admin)
}
```

In fine-grained mode each breakdown entry's `group` carries the **service type** (so the UI
can colour it); in legacy mode it carries the cohort group (`children_0_6` / `seniors_65p`).

---

## Backend — `POST /personal-suggest` *(tier-1 paid)*

Rank candidate settlements by the lowest weekly travel time for the household's needs.
**Role-gated:** `PAID_USER` (granted) / `ADMIN`; others get `402 PAYWALL_UPGRADE`.

**Body** — same `PersonalCompareRequest` shape; only `currentLat`/`currentLon` and
`householdProfile.needs` are used. `?top=N` (default 5) caps the results.

```bash
curl -X POST "http://localhost:8080/api/v1/time-poverty/personal-suggest?top=5" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"currentLat":42.10,"currentLon":24.70,"householdProfile":{"needs":["school","clinic"]}}'
```

**Response** (`PersonalSuggestResponse`)

```jsonc
{
  "currentWeeklyHours": 11.1,
  "suggestions": [
    { "settlement": "Priseltsi", "district": "Varna", "lat": 43.11, "lon": 27.83,
      "weeklyHours": 0.21, "hoursSavedVsCurrent": 10.88 }
  ]
}
```

---

## Backend — `GET /planned-projects` *(tier-2 reporter)*

Accountability Radar feed: planned civic builds scraped from the public-procurement
registry (AOP), cached in `planned_municipal_projects`. **Role-gated:** `REPORTER`
(granted) / `ADMIN`; others get `403 ACCESS_REPORTER`. Optional `?amenity=` filter
(`kindergarten`/`school`/`clinic`/`hospital`).

```bash
curl "http://localhost:8080/api/v1/time-poverty/planned-projects?amenity=school" \
  -H "Authorization: Bearer $REPORTER_TOKEN"
```

```jsonc
{
  "available": true, "total": 11,
  "byAmenity": { "kindergarten": 4, "school": 4, "clinic": 3 },
  "projects": [
    { "procurementNumber": "983090", "buyerName": "Община Пловдив",
      "projectName": "…", "amenityType": "kindergarten",
      "lat": 42.13, "lon": 24.79, "district": "Plovdiv", "scrapedAt": "2026-06-20 …" }
  ]
}
```

`available: false` means the scraper table doesn't exist yet (run the scraper — see
[data-pipeline.md](data-pipeline.md)).

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
curl "http://localhost:8000/api/ml/recommend?amenity=kindergarten&district=Stara%20Zagora&top=3"
```

**Response**

```jsonc
{
  "district": "Stara Zagora", "amenity": "kindergarten", "group": "children_0_6",
  "recommendations": [
    { "lat": 42.20, "lon": 25.33, "nearestTown": "Chirpan", "predictedHoursSaved": 218400 }
  ]
}
```

An unknown amenity returns `{ "error": ..., "available": [...] }`; an unknown district
returns `{ "error": "unknown district '...'" }`.

---

## Quick verification

```bash
curl "http://localhost:8080/api/v1/time-poverty/matrix?district=Stara%20Zagora" | head -c 200
curl "http://localhost:8000/api/ml/recommend?amenity=kindergarten&top=3"
curl http://localhost:8000/health
```
