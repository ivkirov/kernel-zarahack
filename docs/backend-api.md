# Backend API — Deep Dive

Java 25 · Spring Boot 4.1.0 · Spring Data JPA. Package root
`com.zarahack.timepoverty`. Serves the authoritative, database-backed time-poverty math on
`:8080` for both app modes. Full request/response shapes are in
[api-reference.md](api-reference.md); the formulas are in [methodology.md](methodology.md).

## Layout

```
backend-api/src/main/java/com/zarahack/timepoverty/
├── TimePovertyApplication.java        # Spring Boot entry point
├── config/
│   ├── CorsConfig.java                # locks CORS to the :5500 demo origin
│   └── AdminSeeder.java               # seeds the one hardcoded admin on startup
├── controller/{TimePoverty,Auth,Admin}Controller.java
├── security/                          # dependency-free auth (no Spring Security)
│   ├── PasswordHasher.java            # PBKDF2-HMAC-SHA256
│   ├── JwtUtil.java                   # hand-rolled HS256 JWT
│   ├── AuthFilter.java               # reads Bearer → CurrentUser (per-request)
│   ├── CurrentUser.java · AuthException.java
│   └── Features.java                  # the single role/tier/quota policy
├── service/
│   ├── TimePovertyService.java        # matrix/simulate/personal math + suggestAreas
│   ├── AuthService.java · UserAdminService.java
│   ├── ExplanationService.java        # tier-1 AI explanation (templated; LLM-swap seam)
│   └── GeoUtil.java                   # haversine + travel-time
├── entity/{InfrastructureNode,DemographicWeight,AppUser}.java · Role.java
├── repository/{InfrastructureNode,DemographicWeight,AppUser}Repository.java
├── web/ApiExceptionHandler.java       # maps AuthException → JSON {code,message}
└── dto/
    ├── {Matrix,Simulation,PersonalCompare}{Request,Response}.java
    ├── PersonalSuggestResponse.java
    └── auth/{Register,Login}Request, AuthResponse, UserView, UpdateUserRequest
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
| `app.auth.jwt-secret` | dev default | HMAC key for signing JWTs (override in prod) |
| `app.auth.jwt-ttl-seconds` | 604800 | token lifetime (7 days) |

The bootstrap admin is **hardcoded** in `AdminSeeder` (not configurable): `admin@gmail.com`
/ `P4$$w0rd!`, seeded on first start of a fresh DB.

These `@Value`-injected fields (`speedKmh`, `visitsChildren`, `visitsSeniors`) feed the
service math directly.

## Controllers

`TimePovertyController` at base `/api/v1/time-poverty` (all require auth):

| Method | Path | Handler | Requires |
| :--- | :--- | :--- | :--- |
| `GET` | `/matrix?district=` | `matrix()` | any signed-in user (shared map data) |
| `POST` | `/simulate` | `simulate()` | municipality (granted) / admin |
| `POST` | `/personal-compare` | `personalCompare()` | free (quota+filters) / paid / admin |
| `POST` | `/personal-suggest?top=` | `personalSuggest()` | paid (tier 1) / admin |
| `GET` | `/planned-projects?amenity=` | `plannedProjects()` | reporter (granted) / admin |

`AuthController` (`/api/v1/auth`): `POST /register`, `POST /login`, `GET /me`.
`AdminController` (`/api/v1/admin`, admin-only): `GET /users`, `PATCH /users/{id}`.

## Auth, roles & gating

Auth is **dependency-free** (no Spring Security / JWT libraries) so the build stays offline
on Spring Boot 4.1 / Java 25:

- `PasswordHasher` — PBKDF2-HMAC-SHA256, stored as `pbkdf2$<iter>$<salt>$<hash>`.
- `JwtUtil` — hand-rolled HS256 (JDK `Mac` + Base64URL), encodes `sub/email/role/exp`.
- `AuthFilter` (`OncePerRequestFilter`) — on every request, verifies the Bearer token and
  loads the fresh `AppUser` into a `CurrentUser` ThreadLocal; never rejects on its own, so
  public routes (`/auth/**`) pass through. Controllers decide what they require.
- `Features` — the single policy: `FREE_GUESS_LIMIT = 3`, `FREE_ALLOWED_AMENITIES =
  {school, clinic, hospital, pharmacy}`, and `canMunicipal/canReporter/canPersonal/
  hasPaidPersonal` checks. `ApiExceptionHandler` maps `AuthException(status, code, msg)` to
  JSON the frontend keys on.

**Roles → tiers:** `PAID_USER` (t1: AI explanation + suggestions + all filters),
`REPORTER` (t2: Radar), `MUNICIPALITY` (t3: municipal planner). `FREE_USER` is limited;
`ADMIN` does everything. Reporter/municipality sign-ups land locked until an admin sets
`accessGranted` — payments are admin-assigned, there is no self-serve upgrade.

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
(positive ⇒ the move returns hours) and a boolean `gain`. The controller layers on gating:
free accounts get a quota + filter limit (`Features`) and **no** `aiExplanation`; paid/admin
get the `ExplanationService` narrative.

### `suggestAreas(request, topN)` — `POST /personal-suggest` (tier-1 paid)
Scores one representative centroid per settlement (its largest-population cell) for the
household's needs and returns the `topN` with the lowest weekly hours, plus
`hoursSavedVsCurrent` against the current pin.

## `GeoUtil`
- `haversineKm(lat1, lon1, lat2, lon2)` — Earth radius `6371.0088 km`.
- `travelMinutes(km, speedKmh)` — `km / speedKmh × 60`.

Covered by `GeoUtilTest` (`src/test`).

## Entities & repositories
- `InfrastructureNode` ↔ `infrastructure_nodes`; `DemographicWeight` ↔ `demographic_weights`;
  `AppUser` ↔ `app_users` (schema in [data-pipeline.md](data-pipeline.md)).
- Repositories are Spring Data `JpaRepository`: `findByDistrict(String)` derived queries plus
  the inherited `findAll()`; `AppUserRepository` adds `findByEmail` / `existsByEmail`.
- `ddl-auto: validate` means every table — including `app_users` — must pre-exist; the
  `data-engine` owns the schema (`00b_create_auth_schema.py`).

## CORS
`CorsConfig` allows `http://localhost:5500` and `http://127.0.0.1:5500` for
GET/POST/PUT/PATCH/DELETE/OPTIONS and all headers (so the `Authorization` bearer header is
accepted) on `/api/**`. It is the single authoritative source — controllers no longer carry
a `@CrossOrigin` annotation.
