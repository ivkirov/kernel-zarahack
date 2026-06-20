# Backend API — Deep Dive

Java 25 · Spring Boot 4.1.0 · Spring Data JPA. Package root
`com.zarahack.timepoverty`. Serves the authoritative, database-backed time-poverty math on
`:8080` for both app modes. Full request/response shapes are in
[api-reference.md](api-reference.md); the formulas are in [methodology.md](methodology.md).

## Layout

```
backend-api/src/main/java/com/zarahack/timepoverty/
├── TimePovertyApplication.java        # Spring Boot entry point
├── config/CorsConfig.java             # locks CORS to the :5500 demo origin
├── controller/TimePovertyController.java
├── service/
│   ├── TimePovertyService.java        # all the math
│   └── GeoUtil.java                   # haversine + travel-time
├── entity/{InfrastructureNode,DemographicWeight}.java
├── repository/{InfrastructureNode,DemographicWeight}Repository.java
└── dto/{Matrix,Simulation,PersonalCompare}{Request,Response}.java
```

## Configuration (`application.yml`)

| Key | Value | Meaning |
| :--- | :--- | :--- |
| `server.port` | 8080 | HTTP port |
| datasource | `PG*` env vars | host/db/user/password from the environment |
| Hikari pool | max 5 | connection pool ceiling |
| `jpa.hibernate.ddl-auto` | `validate` | schema must pre-exist (seeded by `data-engine`) |
| `app.geo.assumed-speed-kmh` | 4.5 | walking-speed proxy |
| `app.visits-per-year.children_0_6` | 180 | annual round trips |
| `app.visits-per-year.seniors_65p` | 24 | annual round trips |

These `@Value`-injected fields (`speedKmh`, `visitsChildren`, `visitsSeniors`) feed the
service math directly.

## Controller

A single `@RestController` at base path `/api/v1/time-poverty`:

| Method | Path | Handler |
| :--- | :--- | :--- |
| `GET` | `/matrix?district=` | `matrix()` (default `Pazardzhik`) |
| `POST` | `/simulate` | `simulate()` |
| `POST` | `/personal-compare` | `personalCompare()` |

## Service — `TimePovertyService`

### Core maps
- `GROUP_SERVICES` — `children_0_6 → [kindergarten, school]`,
  `seniors_65p → [hospital, clinic, pharmacy]`.
- `SERVICE_VISITS` — per-amenity annual round trips for the personal planner
  (kindergarten/school 380, clinic 18, hospital 6, pharmacy 30).
- `SERVICE_LABEL` — human-friendly labels for the UI breakdown.

### District scope
`isNationwide(d)` is true when the district is null/blank/`"all"`/`"All Bulgaria"`. Nationwide
queries use `findAll()`; otherwise `findByDistrict(d)`. This applies to both nodes and
weights.

### `buildMatrix(district)` — `GET /matrix`
1. Load nodes + weights for the district.
2. **Pre-bucket** nodes by the group they serve (`servingByGroup`) so the inner loop doesn't
   re-filter — important for the nationwide view (~14k cells × ~2.8k nodes).
3. For each demographic cell: `nearestMinutes` to its serving nodes → `annualWastedHours`
   and `timePovertyScore = nearestMinutes × population`; accumulate the systemic total.
4. Return all nodes (markers), all cells (choropleth), and `totalAnnualWastedHours`.

Annotated `@Cacheable("matrix")` — the heavy nationwide computation is cached per district,
so repeat loads and province switches are instant.

### `simulate(request)` — `POST /simulate`
Resolves which group the new amenity serves, then for every cell of that group computes
`after = min(before, travelMinutes(distance to new node))`. Cells that genuinely improve
(`after < before − 1e-6`) contribute to `annualWastedHoursSaved`, `affectedCells`,
`peopleImpacted`, and `minutesSavedPerTripAvg`, with a per-cell delta list for map shading.

### `personalCompare(request)` — `POST /personal-compare`
Evaluates two homes against **all** nodes (`nodeRepo.findAll()`; the payload carries no
district). Two code paths:

- **Fine-grained needs** (preferred) — when `householdProfile.needs` is a non-empty list of
  amenity keys, each need is scored individually at its own `SERVICE_VISITS` cadence via
  `weeklyHoursService()`, and `group` in the breakdown carries the *service type* so the UI
  can colour it.
- **Legacy coarse flags** — `hasChildren` / `needsSeniorCare` map to the two cohort groups
  and use `weeklyHours()` at the annual `visitsFor(group)` cadence. If neither flag is set,
  both groups are evaluated.

Returns weekly hours per residence plus `efficiencyShiftHours = current − prospective`
(positive ⇒ the move returns hours) and a boolean `gain`.

## `GeoUtil`
- `haversineKm(lat1, lon1, lat2, lon2)` — Earth radius `6371.0088 km`.
- `travelMinutes(km, speedKmh)` — `km / speedKmh × 60`.

Covered by `GeoUtilTest` (`src/test`).

## Entities & repositories
- `InfrastructureNode` ↔ `infrastructure_nodes`; `DemographicWeight` ↔ `demographic_weights`
  (schema in [data-pipeline.md](data-pipeline.md)).
- Repositories are Spring Data `JpaRepository` with `findByDistrict(String)` derived queries
  plus the inherited `findAll()`.

## CORS
`CorsConfig` allows `http://localhost:5500` and `http://127.0.0.1:5500` for
GET/POST/OPTIONS on `/api/**`. The controller also carries a permissive `@CrossOrigin` for
dev convenience; the config bean is the authoritative lock-down for the demo origin.
