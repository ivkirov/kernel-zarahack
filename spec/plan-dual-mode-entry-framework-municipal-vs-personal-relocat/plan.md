# Plan — Dual-Mode Entry Framework (Municipal vs. Personal Relocation)

## Context

Reclaim currently boots straight into a single municipal dashboard
(full Leaflet map + systemic time-loss HUD). The request is to add a **landing portal**
that lets a user pick between two modes:

- **A — Municipal Infrastructure Optimization** — the existing dashboard, unchanged.
- **B — Personal Relocation Planner** — a new flow where a user drops two pins
  (current vs. prospective home) and sees their personal weekly commute "time-tax"
  and the efficiency shift between the two locations.

The backend math for Mode B already exists on disk from this session:
- `dto/PersonalCompareRequest.java` ✓, `dto/PersonalCompareResponse.java` ✓
- `service/TimePovertyService.personalCompare()` + `weeklyHours()` + `appendBreakdown()` ✓
  (reuses `GROUP_SERVICES`, `nearestMinutes()`, `visitsFor()`, `speedKmh`; uses
  `nodeRepo.findAll()` since the personal payload carries no district).

What's left: expose the endpoint, then build the two-mode frontend.

## Step 1 — Backend: expose the endpoint

Add to the existing `controller/TimePovertyController.java` (same `/api/v1/time-poverty`
base path, so no second controller class):

```java
/** Compare personal weekly commute time-tax between current and prospective homes. */
@PostMapping("/personal-compare")
public PersonalCompareResponse personalCompare(@RequestBody PersonalCompareRequest request) {
    return service.personalCompare(request);
}
```

`PersonalCompareRequest/Response` are already imported via the existing `dto.*` wildcard.

## Step 2 — Frontend `index.html`

1. **Landing overlay** — a full-screen `fixed inset-0 z-[2000] bg-slate-950` flex container
   (`#landing`), with two side-by-side widget cards:
   - Card A `#enterMunicipal`: inline SVG (network/building icon), bold header
     "Municipal Infrastructure Optimization", the spec description, hover accent border.
   - Card B `#enterPersonal`: inline SVG (home icon), bold header
     "Personal Relocation Planner", the spec description.
   Real inline SVG icons (no emoji), consistent with the dark `base`/`panel`/`edge` palette.
2. **Wrap** the existing municipal `<aside>` contents in `#municipalPanel`.
3. **Add `#personalPanel`** (hidden by default) in the same aside slot — the journey wizard:
   - Step buttons `#pinCurrentBtn` (red) / `#pinProspectiveBtn` (green) with lat/lon readouts
     (`#pinCurrentReadout`, `#pinProspectiveReadout`) and an active-step highlight.
   - Household toggles: `#hasChildren`, `#needsSeniorCare` checkboxes.
   - Three comparison cards (shown once both pins set):
     `#currentWeekly`, `#prospectiveWeekly`, and the efficiency badge `#efficiencyShift`
     (green `text-emerald-400` gain / red `text-rose-500` loss).
   - `#personalStatus` line.
4. **Home/back control** `#goHomeBtn` in the aside header to return to the landing overlay.
5. Color class literals (`bg-slate-950`, `text-emerald-400`, `text-rose-500`, etc.) are written
   in full so Tailwind's JIT scan picks them up — these are stock palette colors, available
   alongside the project's custom `extend` colors.

## Step 3 — Frontend `app.js`

1. **Don't auto-run** `loadMatrix()` at module load — gate it behind mode entry.
2. **Mode state** `let mode = null;` plus `enterMunicipal()`, `enterPersonal()`, `goHome()`
   wired to the landing cards + back button; each toggles `#landing`/`#municipalPanel`/
   `#personalPanel` visibility and calls `map.invalidateSize()`.
   - `enterMunicipal()` runs `loadMatrix()` once (guard against re-fetch on re-entry).
3. **Gate the existing `map.on("click")`** handler: municipal simulate only when
   `mode === "municipal"`; personal pin-drop when `mode === "personal"`.
4. **Personal pins** — `personalLayer` layerGroup; red/green `L.divIcon` markers for
   Pin A / Pin B; clicking the map places whichever pin is "armed" (selected via the step
   buttons), updates the readout, and re-runs compare when both are set.
5. **`runCompare()`** — POST `${API_BASE_URL}/personal-compare` with
   `{currentLat, currentLon, prospectiveLat, prospectiveLon, householdProfile:{hasChildren,needsSeniorCare}}`;
   animate the three cards via the existing `animateCounter`; set the efficiency badge text +
   color from `gain`/`efficiencyShiftHours`. Re-run on household-toggle `change`.

## Step 4 — Rebuild Tailwind + verify

- `cd frontend && npm install && npm run build:css` (regenerates `dist/output.css` with the
  new slate/emerald/rose classes).
- `node --check frontend/src/app.js` (syntax).
- Backend: with dummy data seeded and `PG*` exported, `mvn -f backend-api spring-boot:run`, then
  `curl -X POST http://localhost:8080/api/v1/time-poverty/personal-compare -H 'Content-Type: application/json' -d '{"currentLat":42.20,"currentLon":24.30,"prospectiveLat":42.19,"prospectiveLon":24.34,"householdProfile":{"hasChildren":true,"needsSeniorCare":false}}'`
  → returns `currentWeeklyHours`, `prospectiveWeeklyHours`, `efficiencyShiftHours`, `gain`, breakdowns.
- Frontend: `npm run serve`, open `http://localhost:5500` — landing overlay shows two cards;
  Card A loads the existing municipal map/HUD; Card B shows the wizard, two-pin placement
  shades the comparison cards and the efficiency badge (emerald gain / rose loss). I'll note
  explicitly if I can't drive a real browser in this environment.

## Files

```
backend-api/.../controller/TimePovertyController.java   (Step 1 — add 1 endpoint)
frontend/index.html                                     (Step 2 — landing + personal panel)
frontend/src/app.js                                     (Step 3 — mode switching + pins + compare)
frontend/dist/output.css                                (Step 4 — regenerated by build:css)
```

Already done earlier this session (no action needed): `PersonalCompareRequest.java`,
`PersonalCompareResponse.java`, `TimePovertyService.personalCompare()`.
