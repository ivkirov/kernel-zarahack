# Frontend — Deep Dive

Tailwind CSS + Leaflet.js single-page app served on `:5500`. A dark dashboard with a
landing portal that routes into two modes (Municipal, Personal) plus the AI recommender.
No framework — plain ES modules driving a Leaflet map.

## Layout

```
frontend/
├── index.html              # landing overlay + municipal panel + personal panel
├── src/
│   ├── config.js           # window.TPM — all tunables and endpoints
│   └── app.js              # map, mode router, fetch/cache, all UI behavior
├── dist/output.css         # compiled Tailwind (npm run build:css)
└── package.json            # build:css + serve (live-server) scripts
```

## Configuration — `window.TPM` (`src/config.js`)

| Key | Default | Role |
| :--- | :--- | :--- |
| `API_BASE_URL` | `http://localhost:8080/api/v1/time-poverty` | Java backend base |
| `ML_BASE_URL` | `http://localhost:8000/api/ml` | Python ML sidecar base |
| `DISTRICT` | `"all"` | default municipal view (whole country) |
| `MAP_CENTER` / `MAP_ZOOM` | `[42.73, 25.48]` / `7` | Bulgaria-centered initial view |
| `COLORS` | per-type hex | marker colours |
| `SERVICE_META` | per-type meta | label, colour, demand group, default-on flag |
| `PERSONAL_NEEDS` | 5 entries | fine-grained needs for the personal planner |
| `MATRIX_CACHE_TTL` | 30 min | client-side matrix cache window |

`SERVICE_META` is the single source of truth for each service type. Pharmacies (1,620 — the
largest set) start hidden (`on: false`) to keep the first view readable.

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
  efficiency badge (emerald gain / rose loss). Re-runs on any need toggle and whenever both
  pins are set. `renderBreakdown()` lists per-need weekly hours.

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
