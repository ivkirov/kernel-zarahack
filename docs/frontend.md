# Frontend — Deep Dive

Tailwind CSS + Leaflet.js single-page app served on `:5500`. A dark dashboard with a login
gate, then a **role-aware** landing portal that routes into the lenses the account is
entitled to (Municipal, Personal, Radar). No framework — plain ES modules driving a Leaflet
map.

## Layout

```
frontend/
├── index.html              # auth overlay + landing + municipal/personal/radar panels + paywall/admin modals
├── src/
│   ├── i18n.js             # BG/EN translations + live switcher
│   ├── config.js           # window.TPM — all tunables and endpoints
│   ├── auth.js             # window.Auth — token, apiFetch, login/register, paywall, admin panel
│   └── app.js              # map, mode router, fetch/cache, role gating, all UI behavior
├── dist/output.css         # compiled Tailwind (npm run build:css)
└── package.json            # build:css + serve (live-server) scripts
```

Load order matters: `i18n.js` → `config.js` → `auth.js` → `app.js`.

## Configuration — `window.TPM` (`src/config.js`)

| Key | Default | Role |
| :--- | :--- | :--- |
| `API_BASE_URL` | `http://localhost:8080/api/v1/time-poverty` | Java backend base |
| `AUTH_BASE_URL` / `ADMIN_BASE_URL` | `…/api/v1/auth` · `…/api/v1/admin` | auth + admin bases |
| `ML_BASE_URL` | `http://localhost:8000/api/ml` | Python ML sidecar base |
| `FREE_ALLOWED_AMENITIES` | school/clinic/hospital/pharmacy | filters a free account may use |
| `FUTURE_NEEDS` | gym, barber | shown-but-locked add-on filters (no data yet) |
| `DISTRICT` | `"all"` | default municipal view (whole country) |
| `MAP_CENTER` / `MAP_ZOOM` | `[42.73, 25.48]` / `7` | Bulgaria-centered initial view |
| `COLORS` | per-type hex | marker colours |
| `SERVICE_META` | per-type meta | label, colour, demand group, default-on flag |
| `PERSONAL_NEEDS` | 5 entries | fine-grained needs for the personal planner |
| `MATRIX_CACHE_TTL` | 30 min | client-side matrix cache window |

`SERVICE_META` is the single source of truth for each service type. Pharmacies (1,620 — the
largest set) start hidden (`on: false`) to keep the first view readable.

## Accounts, roles & gating (`src/auth.js` + `src/app.js`)

- **Auth gate** — `auth.js` shows `#authOverlay` (login/register) until a valid session
  exists, stores the JWT in `localStorage` (`tpm_token`), and bootstraps via `GET /auth/me`.
- **`Auth.apiFetch`** — the single wrapper every `/time-poverty` call goes through: adds the
  bearer header, force-logs-out on `401`, and on `402/403` reads the `{code}` body and pops
  the **paywall modal**. ML (`:8000`) calls stay on plain `fetch` (no auth there).
- **Role-aware landing** — `Auth.onReady` → `applyRoleGating(user)` shows only the cards the
  role allows (admin sees all three + "Manage users"); `gateEnter()` pops a paywall (e.g.
  `ACCESS_PENDING`) instead of entering when a paid role isn't yet granted.
- **Admin panel** — `Auth.openAdmin()` lists accounts and PATCHes role / `accessGranted`;
  `ADMIN` is not an assignable role and the admin's own row is read-only.
- **Demo paid/free toggle** — admin-only switch above the legend (`#paidToggle`,
  browser-cached `tpm_demo_paid`) so the admin can preview the free experience.
  `personalIsFree()` / `personalIsPaid()` resolve effective entitlements (role, or the toggle
  for admin); a free view locks non-allowed filters/layers (🔒 → paywall) and shows a quota
  meter that counts down to a `PAYWALL_QUOTA` (simulated client-side for the admin demo,
  authoritative server count for real free users).

## Modes & routing (`src/app.js`)

A `mode` state (`null` until entry) gates everything:

- **Landing overlay** — two widget cards (`#enterMunicipal`, `#enterPersonal`) over a
  full-screen layer. `enterMunicipal()` / `enterPersonal()` toggle the panels, call
  `map.invalidateSize()`, and a GSAP `dismissLanding` fades the overlay out. `goHome()`
  returns to the portal.
- The shared `map.on("click")` handler is **gated by `mode`**: municipal simulate vs.
  personal pin-drop. `enterMunicipal()` runs `loadMatrix()` once (guarded against re-fetch).

## Municipal mode

- **`loadMatrix()`** → `GET /matrix?district=`, fits map bounds, draws nodes and the
  choropleth.
- **Layers** — one Leaflet layer group per service type (`serviceLayers`) plus
  `cellLayer / simLayer / personalLayer / recoLayer`. `preferCanvas` for performance.
  Per-type visibility toggles and collapsible panels.
- **`drawNodes()` / `drawCells()`** — markers coloured from `SERVICE_META`; cells shaded by a
  `povertyColor` ramp.
- **Province picker** — `districtSelect` reloads the matrix for the chosen province (or *All
  Bulgaria*).
- **Simulate** — clicking the map calls `simulateAt()` → `POST /simulate`; the HUD animates
  *Annual Hours Saved*, people impacted, and neighborhoods improved via `animateCounter`.
- **AI recommend** — `recommendSites()` → `GET ML /recommend?amenity&district&top=3`; renders
  numbered green markers plus a ranked list.

## Personal mode

- **Two pins** — red **Current** / green **Prospective** `L.divIcon` markers in
  `personalLayer`. Step buttons "arm" a pin (`armPin`); the next map click places it
  (`placePin` / `dropPersonalPin`) and updates the readout.
- **Needs UI** — `buildNeeds()` renders the `PERSONAL_NEEDS` toggles; `selectedNeeds()`
  collects the active set.
- **`runCompare()`** → `POST /personal-compare` with
  `householdProfile: { needs: [...] }`; animates the three comparison cards and sets the
  efficiency badge (emerald gain / rose loss). `renderBreakdown()` lists per-need weekly
  hours. Paid/admin additionally see the **AI explanation** card; free accounts see a locked
  teaser. Free toggles don't re-spend a check (recompute happens on the next pin drop).
- **Suggest best areas** *(paid)* — `suggestAreas()` → `POST /personal-suggest`; renders
  ranked settlement markers + a list; locked (🔒 → paywall) for free accounts.

## Client-side caching

`fetchMatrix()` wraps the matrix call with a two-tier cache: an in-memory map plus
`localStorage`, keyed by district and bounded by `MATRIX_CACHE_TTL` (30 min). Province
switches within the window are instant and skip the network.

## Motion & accessibility

GSAP powers entrance animations (`revealStagger`, `pop`) and the landing dismiss, all gated
behind a reduced-motion check. A loading overlay covers the initial matrix fetch. Icons are
inline SVG (no emoji as controls), consistent with the dark slate/emerald/rose palette.

## Build & serve

```bash
cd frontend
npm install
npm run build:css     # compile Tailwind → dist/output.css
npm run serve         # live-server → http://localhost:5500
```

Tailwind's JIT scans `index.html` + `src/` for class literals, so stock palette classes
(`bg-slate-950`, `text-emerald-400`, `text-rose-500`, …) are written in full alongside the
project's custom `extend` colours. Re-run `build:css` after adding new utility classes.
