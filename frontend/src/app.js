const {
  API_BASE_URL, ML_BASE_URL, DISTRICT, MAP_CENTER, MAP_ZOOM,
  COLORS, SERVICE_META, PERSONAL_NEEDS, MATRIX_CACHE_TTL,
  BG_BOUNDS, BG_OUTLINE_URL, REGION_BOUNDS_URL, OUT_OF_BOUNDS_MSG,
  FREE_ALLOWED_AMENITIES, FUTURE_NEEDS,
} = window.TPM;

// ---- account / role state (populated by auth.js via Auth.onReady) ----
let currentUser = null;
const isAdmin = () => currentUser && currentUser.role === "ADMIN";

// Demo toggle: lets the admin preview the paid vs free personal experience.
// Browser-cached, default OFF (= free). Only affects the admin's own view; the
// backend always grants the admin, so this is purely a presentation switch.
const DEMO_PAID_KEY = "tpm_demo_paid";
let demoPaid = (() => { try { return localStorage.getItem(DEMO_PAID_KEY) === "1"; } catch { return false; } })();
function setDemoPaid(v) { demoPaid = !!v; try { localStorage.setItem(DEMO_PAID_KEY, v ? "1" : "0"); } catch { /* ignore */ } }

// Effective personal-lens entitlements. For the admin these follow the demo
// toggle; for real accounts they follow the role/tier.
function personalIsPaid() {
  if (!currentUser) return false;
  if (currentUser.role === "ADMIN") return demoPaid;
  if (currentUser.role === "PAID_USER") return !!currentUser.active;
  return false;
}
function personalIsFree() {
  if (!currentUser) return false;
  if (currentUser.role === "ADMIN") return !demoPaid;
  return currentUser.role === "FREE_USER";
}
// Free experience may only filter by a fixed amenity set; paid/admin = anything.
const amenityLockedForUser = (key) =>
  personalIsFree() && !FREE_ALLOWED_AMENITIES.includes(key);

// The admin's demo-free mode has no server-side quota (the backend always grants
// the admin), so we simulate the free allowance client-side to make the demo real.
const quotaIsClientSide = () => isAdmin() && personalIsFree();

// Active municipal district; "all" = whole country. Mutable via the province picker.
let district = DISTRICT;

// ---------- Leaflet init ----------
// preferCanvas keeps the nationwide view (~17k vector layers) smooth.
// maxBounds + full viscosity hard-clamp panning to Bulgaria (scroll too far → snaps back).
const BG_LATLNG_BOUNDS = L.latLngBounds(BG_BOUNDS);
const map = L.map("map", {
  zoomControl: false, preferCanvas: true,         // zoom moved bottom-right (top-left = back arrow)
  maxBounds: BG_LATLNG_BOUNDS, maxBoundsViscosity: 1.0, minZoom: 7,
}).setView(MAP_CENTER, MAP_ZOOM);
L.control.zoom({ position: "bottomright" }).addTo(map);

// Swappable basemap: dark ink tiles, or a Google-Maps-style light street basemap
// (CARTO Voyager — no API key, closest free look to Google Maps).
// dark = CARTO dark ink; maps = OSM standard (bright, saturated greens/blues —
// the most vivid no-key basemap, closest to Google Maps' brightness).
const BASEMAPS = {
  dark: { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
          attribution: "© OpenStreetMap, © CARTO", subdomains: "abcd", maxZoom: 19 },
  maps: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          attribution: "© OpenStreetMap contributors", subdomains: "abc", maxZoom: 19 },
};
let baseTiles = null;
function setBasemap(theme) {
  if (baseTiles) map.removeLayer(baseTiles);
  const cfg = BASEMAPS[theme] || BASEMAPS.dark;
  baseTiles = L.tileLayer(cfg.url, {
    attribution: cfg.attribution, subdomains: cfg.subdomains, maxZoom: cfg.maxZoom,
  }).addTo(map);
  baseTiles.bringToBack();
}

// ---------- Global theme switcher (dark ↔ Google-Maps light) ----------
const THEME_KEY = "tpm-theme";
let bgOutline = null;   // country outline polygon, recolored per theme
let regionBorders = null; // ADM1 province (област) borders layer, recolored per theme
// Thick, no-fill province boundaries so it's clear where each област ends.
const regionStyle = (maps) => ({
  color: maps ? "#334155" : "#cbd5e1", weight: 2.5, opacity: maps ? 0.75 : 0.55,
  fill: false, interactive: false,
});
function currentTheme() { return localStorage.getItem(THEME_KEY) === "maps" ? "maps" : "dark"; }
function applyTheme(theme) {
  const maps = theme === "maps";
  const root = document.documentElement;
  root.classList.toggle("theme-maps", maps);
  root.classList.toggle("dark", !maps);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", maps ? "#ffffff" : "#0a0f1e");
  setBasemap(theme);
  if (bgOutline) bgOutline.setStyle({ color: maps ? "#1a73e8" : "#38bdf8" });
  if (regionBorders) regionBorders.setStyle(regionStyle(maps));
  document.querySelectorAll("[data-theme-opt]").forEach((b) => {
    const on = b.dataset.themeOpt === theme;
    b.classList.toggle("is-active", on);
    b.classList.toggle("text-muted", !on);
  });
  localStorage.setItem(THEME_KEY, theme);
}
document.querySelectorAll("[data-theme-opt]").forEach((b) =>
  b.addEventListener("click", () => applyTheme(b.dataset.themeOpt)));
applyTheme(currentTheme());   // sets the initial basemap too

// ---------- Bulgaria geofence (outline + point-in-country test) ----------
let bgRings = null;   // array of [ [lng,lat], ... ] outer rings
async function loadBulgariaOutline() {
  try {
    const res = await fetch(BG_OUTLINE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bgRings = (await res.json()).rings;
    // Faint outline so the data region reads as intentional, not a crop.
    // Each ring is its own polygon (multipolygon), not holes of one.
    const latlngs = bgRings.map((r) => [r.map(([lng, lat]) => [lat, lng])]);
    bgOutline = L.polygon(latlngs, {
      color: currentTheme() === "maps" ? "#1a73e8" : "#38bdf8", weight: 1, opacity: 0.35,
      fill: false, interactive: false,
    }).addTo(map);
  } catch (err) {
    console.warn("Bulgaria outline failed to load; click-gating disabled:", err);
  }
}
loadBulgariaOutline();

// ---------- Province (област / ADM1) borders ----------
// Drawn under the markers/choropleth and never intercepts clicks.
async function loadRegionBorders() {
  if (!REGION_BOUNDS_URL) return;
  try {
    const res = await fetch(REGION_BOUNDS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    regionBorders = L.geoJSON(await res.json(), {
      style: () => regionStyle(currentTheme() === "maps"),
      interactive: false,
    }).addTo(map);
    regionBorders.bringToBack();
    if (bgOutline) bgOutline.bringToFront();   // keep the country edge above the region grid
  } catch (err) {
    console.warn("Province borders failed to load:", err);
  }
}
loadRegionBorders();

// Ray-casting point-in-polygon over the outer rings (true if inside any province).
function inBulgaria(lat, lng) {
  if (!bgRings) return BG_LATLNG_BOUNDS.contains([lat, lng]);   // fallback: bbox
  for (const ring of bgRings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const hit = (yi > lat) !== (yj > lat) &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (hit) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

// Localized label for a service type (plural form, used in popups + toggles).
const svcLabel = (type) => t(`svc.${type}`);
// Translate `key`, but fall back to a provided string when the key is unknown
// (t() returns the key itself on a miss).
const tOr = (key, fallback) => { const v = t(key); return v === key ? fallback : v; };

// Reusable "out of bounds" popup.
function outOfBoundsPopup(latlng) {
  L.popup({ closeButton: true, className: "" })
    .setLatLng(latlng)
    .setContent(`<b>${t("oob.title")}</b><br>${t("oob.msg")}`)
    .openOn(map);
}

// One layer group per service type so filtering is a cheap add/remove (no redraw).
const serviceLayers = {};
Object.keys(SERVICE_META).forEach((t) => (serviceLayers[t] = L.layerGroup()));

const cellLayer = L.layerGroup().addTo(map);
const simLayer  = L.layerGroup().addTo(map);
const personalLayer = L.layerGroup().addTo(map);
const recoLayer = L.layerGroup().addTo(map);   // AI placement recommendations
const radarLayer = L.layerGroup().addTo(map);  // Radar: project + optimal-site markers

// Visibility state (mirrors SERVICE_META defaults + the choropleth toggle).
const layerState = {};
Object.entries(SERVICE_META).forEach(([t, m]) => (layerState[t] = m.on));
let cellsOn = true;

// Keep Leaflet sized to its container when the layout reflows (responsive stack).
window.addEventListener("resize", () => map.invalidateSize());

const $ = (id) => document.getElementById(id);
function show(el, visible) { el && el.classList.toggle("hidden", !visible); }

// ---------- Localized status lines ----------
// We remember the last status as a (key, params) pair so a live locale switch
// can re-render the message in the new language without re-running the action.
let lastStatus = null;          // { key, params } | null
let lastPersonalStatus = null;
function setStatus(key, params) {
  lastStatus = key ? { key, params } : null;
  const el = $("status");
  if (el) el.textContent = key ? t(key, params) : "";
}
function setPersonalStatus(key, params) {
  lastPersonalStatus = key ? { key, params } : null;
  const el = $("personalStatus");
  if (el) el.textContent = key ? t(key, params) : "";
}

// ---------- GSAP entrance helpers (gated on reduced-motion) ----------
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const gsapOK = typeof gsap !== "undefined" && !reduceMotion;

// autoAlpha + clearProps guarantees elements end fully visible with no stuck inline
// opacity, even if a tween is re-run or interrupted.
function revealStagger(targets, opts = {}) {
  if (!gsapOK) return;
  const els = gsap.utils.toArray(targets);
  if (!els.length) return;
  gsap.killTweensOf(els);
  gsap.fromTo(els,
    { autoAlpha: 0, y: opts.y ?? 14 },
    { autoAlpha: 1, y: 0, duration: opts.duration ?? 0.5, ease: "power2.out",
      stagger: opts.stagger ?? 0.06, delay: opts.delay ?? 0, overwrite: true,
      clearProps: "transform,opacity,visibility" });
}
function pop(target, opts = {}) {
  if (!gsapOK) return;
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return;
  gsap.killTweensOf(el);
  gsap.fromTo(el, { autoAlpha: 0, y: 10 },
    { autoAlpha: 1, y: 0, duration: 0.45, ease: "power2.out", clearProps: "transform,opacity,visibility", ...opts });
}

// Failsafe: under no circumstance leave staggered content invisible.
setTimeout(() => {
  document.querySelectorAll("[data-stagger]").forEach((el) => {
    el.style.opacity = ""; el.style.visibility = "";
  });
}, 1600);

// Landing portal cascades in on first paint.
revealStagger("#landing [data-stagger]", { y: 22, duration: 0.6, stagger: 0.09 });

// ---------- Loading overlay ----------
function showLoading(text) {
  const o = $("mapLoading");
  if (!o) return;
  if (text) $("mapLoadingText").textContent = text;
  o.classList.remove("hidden");
  o.style.opacity = "1";
  o.style.pointerEvents = "auto";
}
function hideLoading() {
  const o = $("mapLoading");
  if (!o) return;
  o.style.opacity = "0";
  o.style.pointerEvents = "none";
  setTimeout(() => o.classList.add("hidden"), 500);
}

// ---------- Animated counter (requestAnimationFrame) ----------
function animateCounter(el, to, { decimals = 0 } = {}) {
  if (!el) return;
  const from = parseFloat(el.dataset.val || "0");
  const start = performance.now();
  const dur = 900;
  function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);             // easeOutCubic
    const val = from + (to - from) * eased;
    el.childNodes[0]
      ? (el.childNodes[0].nodeValue = val.toLocaleString(undefined, { maximumFractionDigits: decimals }))
      : (el.textContent = val.toFixed(decimals));
    if (t < 1) requestAnimationFrame(frame);
    else el.dataset.val = String(to);
  }
  el.dataset.val = el.dataset.val || "0";
  requestAnimationFrame(frame);
}
function setText(id, value, opts) { animateCounter($(id), value, opts); }

// ---------- Color ramp for time-poverty choropleth ----------
function povertyColor(minutes) {
  if (minutes > 30) return "#7f1d1d";
  if (minutes > 20) return "#b91c1c";
  if (minutes > 12) return "#f97316";
  if (minutes > 6)  return "#facc15";
  return "#22c55e";
}

// ---------- Matrix fetch with cache (memory + localStorage) ----------
const memCache = {};
async function fetchMatrix(d) {
  if (memCache[d]) return memCache[d];
  const key = `tpm_matrix_${d}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { t, data } = JSON.parse(raw);
      if (Date.now() - t < MATRIX_CACHE_TTL) { memCache[d] = data; return data; }
    }
  } catch { /* corrupt/oversized cache — ignore */ }

  const res = await Auth.apiFetch(`${API_BASE_URL}/matrix?district=${encodeURIComponent(d)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  memCache[d] = data;
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch { /* quota */ }
  return data;
}

// ---------- Drawing ----------
function nodePopup(n) {
  const label = svcLabel(n.serviceType);
  return `<b>${n.name || label}</b><br>${label}`;
}
function drawNodes(nodes) {
  Object.values(serviceLayers).forEach((l) => l.clearLayers());
  if (mode === "radar") { applyLayerVisibility(); return; }  // radar shows choropleth only
  nodes.forEach((n) => {
    const meta = SERVICE_META[n.serviceType];
    const layer = serviceLayers[n.serviceType];
    if (!layer) return;
    if (mode === "municipal" && meta.personalOnly) return;   // pharmacies are personal-only
    L.circleMarker([n.lat, n.lon], {
      radius: 4, color: meta.color, fillColor: meta.color, fillOpacity: 0.9, weight: 1,
    }).bindPopup(nodePopup(n)).addTo(layer);
  });
  applyLayerVisibility();
}
// Every settlement carries TWO demand cells — children 0–6 and seniors 65+ —
// stacked at the same point, each coloured by ITS cohort's travel time. Drawing
// both made green (one age group well-served) and red (the other poorly served)
// overlap at one place. In municipal mode we therefore show only the cohort of
// the picked service, so each settlement reads as a single, unambiguous dot.
let lastCells = [];
function drawCells(cells) {
  lastCells = cells;
  cellLayer.clearLayers();
  const group = mode === "municipal"
    ? (SERVICE_META[$("amenitySelect").value] || {}).group : null;
  const shown = group ? cells.filter((c) => c.groupKey === group) : cells;
  shown.forEach((c) => {
    L.circle([c.lat, c.lon], {
      radius: 120 + Math.sqrt(c.population) * 25,
      color: povertyColor(c.nearestMinutes),
      fillColor: povertyColor(c.nearestMinutes),
      fillOpacity: 0.28, weight: 0.6, opacity: 0.55, interactive: false,
    }).addTo(cellLayer);
  });
  applyLayerVisibility();
}

// Reconcile every layer's on-map presence with the current filter state.
function applyLayerVisibility() {
  Object.keys(serviceLayers).forEach((t) => {
    const want = !!layerState[t], has = map.hasLayer(serviceLayers[t]);
    if (want && !has) serviceLayers[t].addTo(map);
    else if (!want && has) map.removeLayer(serviceLayers[t]);
  });
  const cellsHas = map.hasLayer(cellLayer);
  if (cellsOn && !cellsHas) cellLayer.addTo(map);
  else if (!cellsOn && cellsHas) map.removeLayer(cellLayer);
}

// Programmatically flip a service layer on/off and keep its checkbox in sync.
function setLayerVisible(type, on) {
  if (!(type in serviceLayers)) return;
  layerState[type] = on;
  const cb = $(`lyr_${type}`);
  if (cb) cb.checked = on;
  applyLayerVisibility();
}

// ---------- Layer filter UI ----------
// personalOnly layers (pharmacies) are hidden in municipal mode and shown in personal.
function setModeLayerDefaults(forMode) {
  Object.entries(SERVICE_META).forEach(([t, m]) => {
    if (m.personalOnly) layerState[t] = forMode === "personal" ? m.on : false;
  });
}
function buildLayerToggles(forMode) {
  const box = $("layerToggles");
  box.innerHTML = "";
  Object.entries(SERVICE_META).forEach(([type, m]) => {
    if (forMode === "municipal" && m.personalOnly) return;   // no pharmacy toggle here
    const locked = forMode === "personal" && amenityLockedForUser(type);
    if (locked) { layerState[type] = false; }
    const row = document.createElement("label");
    row.className = "flex items-center gap-2.5 text-xs text-slate-200 " + (locked ? "opacity-60 cursor-pointer" : "cursor-pointer");
    row.innerHTML =
      `<input type="checkbox" id="lyr_${type}" ${layerState[type] ? "checked" : ""} ${locked ? "disabled" : ""} class="accent-accent w-3.5 h-3.5"/>` +
      `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${m.color}"></span>${svcLabel(type)}` +
      (locked ? `<span class="ml-auto text-[11px]">🔒</span>` : "");
    box.appendChild(row);
    if (locked) {
      row.addEventListener("click", (e) => { e.preventDefault(); Auth.showPaywall("PAYWALL_FILTER"); });
      return;
    }
    row.querySelector("input").addEventListener("change", (e) => {
      layerState[type] = e.target.checked;
      applyLayerVisibility();
      if (forMode === "personal") syncNeedToLayer(type, e.target.checked);
    });
  });
}
setModeLayerDefaults("municipal");
buildLayerToggles("municipal");

$("toggleCells").addEventListener("change", (e) => { cellsOn = e.target.checked; applyLayerVisibility(); });

// Switching the service re-paints the heatmap to that service's cohort (no refetch).
$("amenitySelect").addEventListener("change", () => {
  if (mode === "municipal") drawCells(lastCells);
});

// Collapsible panels (legend + layers) save space on small viewports.
function wireCollapse(btnId, bodyId) {
  const btn = $(btnId), body = $(bodyId);
  if (!btn || !body) return;
  btn.addEventListener("click", () => {
    const hidden = body.classList.toggle("hidden");
    btn.textContent = hidden ? "+" : "−";
  });
}
wireCollapse("legendToggle", "legendBody");
wireCollapse("layerToggle", "layerBody");

// ---------- Load baseline matrix (municipal) ----------
async function loadMatrix() {
  showLoading(t("map.loading.matrix"));
  setStatus("status.loadingMatrix");
  try {
    const data = await fetchMatrix(district);
    drawNodes(data.nodes);
    drawCells(data.cells);
    setText("systemicHours", data.totalAnnualWastedHours, { decimals: 0 });
    setStatus("status.loaded", { nodes: data.nodes.length, cells: data.cells.length });
    const pts = [];
    data.nodes.forEach((n) => pts.push([n.lat, n.lon]));
    data.cells.forEach((c) => pts.push([c.lat, c.lon]));
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [25, 25] });
  } catch (err) {
    setStatus("status.matrixFailed", { err: err.message });
    console.error("loadMatrix failed:", err);
  } finally {
    hideLoading();
  }
}

// Personal mode still wants structures on the map — reuse the cached nationwide nodes,
// but no choropleth (cells are a municipal concept).
async function loadPersonalStructures() {
  showLoading(t("map.loading.services"));
  try {
    const data = await fetchMatrix("all");
    drawNodes(data.nodes);
    cellLayer.clearLayers();
  } catch (err) {
    setPersonalStatus("status.servicesFailed", { err: err.message });
    console.error("loadPersonalStructures failed:", err);
  } finally {
    hideLoading();
  }
}

// ---------- Municipal: AI site-explanation card ----------
const uiLang = () => (window.I18n && window.I18n.locale) || "bg";
function showSiteAi(text) {
  const card = $("siteAiCard"), el = $("siteAiText");
  if (!card || !el) return;
  el.textContent = text;
  show(card, true);
}
function hideSiteAi() { show($("siteAiCard"), false); }

// Nearest known settlement name to a point — labels the AI write-up ("…near X").
async function nearestTownName(lat, lon) {
  try {
    const towns = await ensureTownData();
    let best = null, bd = Infinity;
    for (const tw of towns) {
      const dx = tw.lat - lat, dy = (tw.lon - lon) * Math.cos(lat * Math.PI / 180);
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = tw; }
    }
    return best ? best.settlement : null;
  } catch { return null; }
}

// ---------- Municipal: click → simulate ----------
async function simulateAt(e) {
  const amenityType = $("amenitySelect").value;
  const townName = await nearestTownName(e.latlng.lat, e.latlng.lng);
  const payload = {
    district, lat: e.latlng.lat, lon: e.latlng.lng, amenityType,
    explain: true, language: uiLang(), townName,
  };

  simLayer.clearLayers();
  L.marker([payload.lat, payload.lon]).addTo(simLayer)
    .bindPopup(t("sim.popup", { amenity: svcLabel(amenityType) })).openPopup();

  setStatus("status.simulating");
  showSiteAi(t("site.aiThinking"));

  const res = await Auth.apiFetch(`${API_BASE_URL}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const sim = await res.json();

  setText("hoursSaved", sim.annualWastedHoursSaved, { decimals: 0 });
  setText("peopleImpacted", sim.peopleImpacted, { decimals: 0 });
  setText("cellsImproved", sim.affectedCells, { decimals: 0 });
  setText("avgMinutes", sim.minutesSavedPerTripAvg, { decimals: 1 });

  sim.deltas.forEach((d) => {
    L.circle([d.lat, d.lon], {
      radius: 120 + Math.sqrt(d.population) * 25,
      color: COLORS.simulated, fillColor: COLORS.simulated,
      fillOpacity: 0.35, weight: 1, interactive: false,
    }).addTo(simLayer);
  });

  if (sim.aiExplanation) showSiteAi(sim.aiExplanation);
  else hideSiteAi();

  // Zero improvement means the spot is already covered — say so instead of bare 0s.
  if (sim.affectedCells > 0) {
    setStatus("status.simSaved", { hours: sim.annualWastedHoursSaved.toLocaleString() });
  } else {
    setStatus("status.simWellServed", { amenity: svcLabel(amenityType).toLowerCase() });
  }
}

// ---------- Municipal: AI "recommend best sites" (placement bot, :8000) ----------
function recoIcon(rank) {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;
      width:26px;height:26px;border-radius:50%;background:#10b981;color:#031;
      font-weight:700;font-size:13px;border:2px solid #022c22;
      box-shadow:0 0 0 4px rgba(16,185,129,.35)">${rank}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 13],
  });
}

async function recommendSites() {
  const amenity = $("amenitySelect").value;
  const btn = $("recommendBtn");
  const list = $("recoResults");

  btn.disabled = true;
  setStatus("reco.asking");
  list.innerHTML = "";
  recoLayer.clearLayers();

  try {
    // Always recommend within what the user is actually looking at: the current
    // map viewport. Picking a city (flyTo), a province (fitBounds), or just
    // panning all move the viewport, so this one rule covers "whole
    // municipality", "a single city", and "the half of the map I've scrolled to".
    const b = map.getBounds();
    const sw = b.getSouthWest(), ne = b.getNorthEast();
    // Spread the 3 sites across the view: separation ≈ 1/6 of its width, clamped
    // so a tight city view still yields distinct points and a country-wide view
    // doesn't bunch them at one town.
    const widthKm = map.distance(b.getNorthWest(), b.getNorthEast()) / 1000;
    const sep = Math.max(0.8, Math.min(8, widthKm / 6));
    let url = `${ML_BASE_URL}/recommend?amenity=${encodeURIComponent(amenity)}&top=3`
      + `&min_lat=${sw.lat.toFixed(5)}&min_lon=${sw.lng.toFixed(5)}`
      + `&max_lat=${ne.lat.toFixed(5)}&max_lon=${ne.lng.toFixed(5)}`
      + `&min_separation_km=${sep.toFixed(2)}`;
    if (district && district !== "all") url += `&district=${encodeURIComponent(district)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const pts = [];
    data.recommendations.forEach((r, i) => {
      const rank = i + 1;
      pts.push([r.lat, r.lon]);
      const amenityLabel = svcLabel(amenity);
      L.marker([r.lat, r.lon], { icon: recoIcon(rank), zIndexOffset: 1000 })
        .addTo(recoLayer)
        .bindPopup(`<b>${t("reco.popupTitle", { rank })}</b><br>` +
                   `${t("reco.popupBuild", { amenity: amenityLabel })}<br>` +
                   `${t("reco.popupNear", { town: r.nearestTown })}<br>` +
                   `${t("reco.popupPred", { hours: `<b>${r.predictedHoursSaved.toLocaleString()}</b>` })}`);

      const li = document.createElement("li");
      li.className = "rounded-lg border border-edge/70 bg-panel2/40 overflow-hidden";
      li.innerHTML =
        `<button type="button" class="reco-head w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-panel2 transition">
           <span class="inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0
             bg-emerald-500 text-emerald-950 text-xs font-bold">${rank}</span>
           <span class="flex-1 min-w-0"><b>${r.nearestTown}</b> — ${r.predictedHoursSaved.toLocaleString()} ${t("unit.h").trim()}<span class="text-muted"> ${t("reco.saved")}</span></span>
           <svg class="reco-caret w-4 h-4 text-faint shrink-0 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
         </button>
         <div class="reco-body hidden px-3 pb-3 pt-0.5 text-[13px] text-slate-300 leading-relaxed"></div>`;
      const head = li.querySelector(".reco-head");
      const body = li.querySelector(".reco-body");
      const caret = li.querySelector(".reco-caret");
      const siteDistrict = (scope === "town" && selectedCity) ? selectedCity.district : district;
      head.addEventListener("click", () => toggleRecoBody(body, caret,
        { lat: r.lat, lon: r.lon, amenity, town: r.nearestTown, district: siteDistrict }));
      list.appendChild(li);
    });
    revealStagger("#recoResults li", { y: 8, duration: 0.4, stagger: 0.08 });

    if (pts.length) {
      // Sites are inside the current view by construction — keep the user's
      // framing instead of re-fitting (which would narrow the next search).
      setStatus("reco.result", { n: pts.length, amenity: svcLabel(amenity) });
    } else {
      setStatus("reco.none");
    }
  } catch (err) {
    setStatus("reco.failed", { err: err.message });
    console.error("recommendSites failed:", err);
  } finally {
    btn.disabled = false;
  }
}

// Expand/collapse one recommendation's AI explanation (lazy-loaded on first open).
async function toggleRecoBody(body, caret, site) {
  const open = body.classList.toggle("hidden") === false;
  caret.style.transform = open ? "rotate(180deg)" : "";
  if (!open || body.dataset.loaded) return;
  body.textContent = t("site.aiThinking");
  try {
    const res = await Auth.apiFetch(`${API_BASE_URL}/simulate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        district: site.district || district, lat: site.lat, lon: site.lon, amenityType: site.amenity,
        explain: true, language: uiLang(), townName: site.town,
      }),
    });
    const sim = await res.json();
    body.textContent = sim.aiExplanation || t("site.aiNone");
    body.dataset.loaded = "1";
  } catch (err) {
    body.textContent = t("site.aiFailed");
  }
}

// ---------- Personal: two-pin relocation compare ----------
const pins = { current: null, prospective: null };
let armedPin = "current";   // which pin the next map click drops

function pinIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;
      background:${color};transform:rotate(-45deg);border:2px solid #0b1020;
      box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 16],
  });
}
const PIN_COLORS = { current: "#f43f5e", prospective: "#34d399" };

// "I own a car" → far trips are driven, not walked. On by default, remembered.
const CAR_KEY = "tpm_owns_car";
const ownsCar = () => { const el = $("ownsCar"); return el ? el.checked : true; };

function armPin(which) {
  armedPin = which;
  $("pinCurrentBtn").classList.toggle("border-rose-500", which === "current");
  $("pinProspectiveBtn").classList.toggle("border-emerald-400", which === "prospective");
}

function placePin(which, latlng) {
  if (pins[which]) personalLayer.removeLayer(pins[which]);
  pins[which] = L.marker(latlng, { icon: pinIcon(PIN_COLORS[which]) }).addTo(personalLayer);
  pins[which].bindPopup(t(which === "current" ? "pin.current" : "pin.prospective"));
  $(which === "current" ? "pinCurrentReadout" : "pinProspectiveReadout")
    .textContent = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
  updateSuggestAvailability();
}

async function dropPersonalPin(e) {
  placePin(armedPin, e.latlng);
  if (armedPin === "current" && !pins.prospective) armPin("prospective");
  if (pins.current && pins.prospective) await runCompare();
}

// ---------- Personal needs UI ----------
const NEED_DEFAULT = new Set(["kindergarten", "school", "clinic", "pharmacy"]);

// Render one need row. `locked` rows pop a paywall on click; `future` rows have
// no dataset yet and just explain that (no paywall — they can't be unlocked).
function needRow(box, key, color, locked, paywallCode, checked, future) {
  const row = document.createElement("label");
  row.dataset.need = key;   // lets a locale switch find + re-label this row
  const dim = locked || future;
  row.className = "flex items-center justify-between gap-2 rounded-lg border border-edge bg-panel2 " +
    "px-3 py-2 transition " + (dim ? "opacity-60 cursor-pointer" : "cursor-pointer hover:border-accent2/60");
  const tag = future
    ? `<span class="need-soon text-[10px] uppercase tracking-wide text-faint border border-edge rounded px-1.5 py-0.5">${t("need.soon")}</span>`
    : `<span class="text-[11px] text-faint need-hint">${locked ? "🔒" : t("needHint." + key)}</span>`;
  row.innerHTML =
    `<span class="flex items-center gap-2.5 text-sm">
      <input type="checkbox" data-need="${key}" ${checked ? "checked" : ""} ${dim ? "disabled" : ""} class="accent-accent2 w-4 h-4"/>
      <span class="w-2.5 h-2.5 rounded-full" style="background:${color}"></span>
      <span class="need-label">${t("need." + key)}</span></span>
    ${tag}`;
  box.appendChild(row);
  const cb = row.querySelector("input");
  if (future) {
    row.addEventListener("click", (e) => { e.preventDefault(); setPersonalStatus("personal.soonHint"); });
    return;
  }
  if (locked) {
    row.addEventListener("click", (e) => { e.preventDefault(); Auth.showPaywall(paywallCode); });
    return;
  }
  cb.addEventListener("change", () => {
    setLayerVisible(key, cb.checked);   // map layers follow the selected filters
    // Free users: don't spend a check on every toggle — recompute on the next pin drop.
    if (personalIsFree()) { setPersonalStatus("personal.toggleHint"); return; }
    runCompare();
  });
}

function buildNeeds() {
  const box = $("needsList");
  box.innerHTML = "";
  PERSONAL_NEEDS.forEach((n) => {
    const color = (SERVICE_META[n.key] || {}).color || "#8ea2c0";
    const locked = amenityLockedForUser(n.key);
    needRow(box, n.key, color, locked, "PAYWALL_FILTER", NEED_DEFAULT.has(n.key) && !locked);
  });
  // Future personal-only filters (gyms, barbers…) — no open dataset yet, so they
  // can't be mapped or compared for anyone (incl. admin); marked "soon", not locked.
  (FUTURE_NEEDS || []).forEach((n) => {
    needRow(box, n.key, n.color, false, null, false, true);
  });
}

// Personal mode: keep the map's service layers in lockstep with the household's
// selected needs, so the user only sees dots for the places they actually filter by.
function syncLayersToNeeds() {
  const checked = new Set(selectedNeeds());
  Object.keys(serviceLayers).forEach((type) => setLayerVisible(type, checked.has(type)));
}
// Reverse: a layer toggled from the Layers panel ticks the matching need too.
function syncNeedToLayer(type, on) {
  const cb = document.querySelector(`#needsList input[data-need="${type}"]`);
  if (!cb || cb.disabled || cb.checked === on) return;
  cb.checked = on;
  if (personalIsFree()) setPersonalStatus("personal.toggleHint");
  else runCompare();
}
function selectedNeeds() {
  return [...document.querySelectorAll('#needsList input[data-need]:checked')].map((i) => i.dataset.need);
}

function renderBreakdown(cur, pro) {
  const ul = $("needBreakdown");
  ul.innerHTML = "";
  if (!cur || !cur.length) return;
  const proBy = {};
  (pro || []).forEach((b) => (proBy[b.label || b.group] = b));
  cur.forEach((b) => {
    const key = b.label || b.group;
    const p = proBy[key] || { weeklyHours: 0 };
    const delta = b.weeklyHours - p.weeklyHours;     // >0 ⇒ moving saves this much
    const cls = delta > 0.05 ? "text-emerald-400" : delta < -0.05 ? "text-rose-400" : "text-faint";
    const sign = delta > 0.05 ? "−" : delta < -0.05 ? "+" : "±";
    const color = (SERVICE_META[b.group] || {}).color || "#8ea2c0";
    // Localize the need label when we recognize the group; else show as-is.
    const display = tOr(`need.${b.group}`, key);
    const li = document.createElement("li");
    li.className = "flex items-center justify-between gap-2";
    li.innerHTML =
      `<span class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full shrink-0" style="background:${color}"></span>${display}</span>
      <span class="tabular-nums text-xs text-muted">${b.weeklyHours.toFixed(1)}→${p.weeklyHours.toFixed(1)}h
        <span class="${cls} font-semibold ml-1">${sign}${Math.abs(delta).toFixed(1)}</span></span>`;
    ul.appendChild(li);
  });
}

async function runCompare() {
  if (!pins.current || !pins.prospective) return;
  const c = pins.current.getLatLng();
  const p = pins.prospective.getLatLng();
  const payload = {
    currentLat: c.lat, currentLon: c.lng,
    prospectiveLat: p.lat, prospectiveLon: p.lng,
    householdProfile: { needs: selectedNeeds(), hasCar: ownsCar() },
    language: (window.I18n && window.I18n.locale) || "bg",
  };

  // Admin demo-free has no server quota — enforce the allowance client-side.
  if (quotaIsClientSide() && (currentUser.freeGuessesRemaining ?? 0) <= 0) {
    Auth.showPaywall("PAYWALL_QUOTA");
    return;
  }

  setPersonalStatus("personal.calculating");
  let data;
  try {
    const res = await Auth.apiFetch(`${API_BASE_URL}/personal-compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    data = await res.json();
    lastCompareData = data;
  } catch (err) {
    // apiFetch already surfaced the paywall/auth modal; just clear the spinner.
    setPersonalStatus(null);
    return;
  }

  show($("comparePanel"), true);
  setText("currentWeekly", data.currentWeeklyHours, { decimals: 1 });
  setText("prospectiveWeekly", data.prospectiveWeeklyHours, { decimals: 1 });
  renderBreakdown(data.currentBreakdown, data.prospectiveBreakdown);

  lastShift = { shift: data.efficiencyShiftHours, gain: data.gain };
  renderEfficiencyBadge();
  renderAiExplanation(data);
  if (data.freeGuessesRemaining != null) updateQuotaBadge(data.freeGuessesRemaining);
  else if (quotaIsClientSide()) {
    updateQuotaBadge(Math.max(0, (currentUser.freeGuessesRemaining ?? currentUser.freeGuessLimit) - 1));
  }

  const needCount = selectedNeeds().length;
  setPersonalStatus("personal.compared", { label: needCount || t("common.all") });
}

// Efficiency badge depends on locale (units + phrasing) — render from stored state.
let lastShift = null;   // { shift, gain } | null
let lastCompareData = null;   // last /personal-compare payload (re-rendered on demo toggle)
function renderEfficiencyBadge() {
  const badge = $("efficiencyShift");
  if (!badge || !lastShift) return;
  const { shift, gain } = lastShift;
  badge.classList.remove("text-emerald-400", "text-rose-500");
  if (gain) {
    badge.classList.add("text-emerald-400");
    badge.textContent = t("badge.returned", { h: shift.toFixed(1) });
  } else {
    badge.classList.add("text-rose-500");
    badge.textContent = t("badge.cost", { h: shift.toFixed(1) });
  }
}

// ---------- Civic Accountability Radar (Pillar 3) ----------
// Amenity badge labels come from i18n (svc.* keys) via svcLabel().

// Great-circle distance (km).
function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Audit verdict colours/glyphs. `far` = the model's optimal sits beyond the
// province's own scale, so the deviation is not a meaningful misalignment.
const AUDIT = {
  good:    { color: "#22c55e", glyph: "✓" },
  review:  { color: "#f59e0b", glyph: "!" },
  flag:    { color: "#ef4444", glyph: "⚑" },
  far:     { color: "#64748b", glyph: "∞" },
  unknown: { color: "#64748b", glyph: "?" },
};
const auditLabel = (verdict) => t(`radar.audit.${verdict}`);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Misalignment is judged relative to the PROVINCE's own size, not a fixed km value:
// `scale` is the size-dependent maximum distance that can still count as misalignment.
// Beyond it, the optimal is simply in a different part of the region → "far" (neutral).
function verdictFor(km, scale) {
  if (km == null) return "unknown";
  if (km <= 0.30 * scale) return "good";
  if (km <= 0.70 * scale) return "review";
  if (km <= scale)        return "flag";
  return "far";
}

// Cache ML optimal-site lookups per district+amenity (avoids N duplicate calls).
const recoCache = {};
async function mlOptimalSites(district, amenity) {
  const key = `${district}|${amenity}`;
  if (recoCache[key]) return recoCache[key];
  const p = (async () => {
    try {
      const url = `${ML_BASE_URL}/recommend?amenity=${encodeURIComponent(amenity)}` +
                  `&district=${encodeURIComponent(district)}&top=3`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return data.recommendations || [];
    } catch { return []; }
  })();
  recoCache[key] = p;
  return p;
}

// Characteristic radius (km) of a province = 90th-percentile settlement distance from
// its centroid. Drives the size-dependent misalignment scale. Cached per district.
const provinceScaleCache = {};
async function provinceScaleKm(district) {
  if (district in provinceScaleCache) return provinceScaleCache[district];
  let scale = 22;   // safe default if the matrix can't be fetched
  try {
    const cells = (await fetchMatrix(district)).cells || [];
    if (cells.length >= 3) {
      const lat = cells.reduce((s, c) => s + c.lat, 0) / cells.length;
      const lon = cells.reduce((s, c) => s + c.lon, 0) / cells.length;
      const d = cells.map((c) => haversineKm(lat, lon, c.lat, c.lon)).sort((a, b) => a - b);
      const r = d[Math.floor(d.length * 0.9)];     // province "radius"
      scale = clamp(r, 10, 35);                     // size-dependent, hard-capped at 35 km
    }
  } catch { /* keep default */ }
  provinceScaleCache[district] = scale;
  return scale;
}

// Cross-reference one project against the model's optimal sites for its district.
async function auditProject(p) {
  if (p.lat == null || p.lon == null || !p.district) {
    return { verdict: "unknown", km: null, optimal: null, scale: null };
  }
  const sites = await mlOptimalSites(p.district, p.amenityType);
  if (!sites.length) return { verdict: "unknown", km: null, optimal: null, scale: null };
  let best = null, bestKm = Infinity;
  for (const s of sites) {
    const km = haversineKm(p.lat, p.lon, s.lat, s.lon);
    if (km < bestKm) { bestKm = km; best = s; }
  }
  const scale = await provinceScaleKm(p.district);
  return { verdict: verdictFor(bestKm, scale), km: bestKm, optimal: best, scale };
}

function radarPinIcon(amenityColor, verdict) {
  const v = AUDIT[verdict];
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:24px;height:24px">
      <div style="width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
        background:${amenityColor};border:2px solid ${v.color};box-shadow:0 1px 6px rgba(0,0,0,.6)"></div>
      <div style="position:absolute;top:-7px;right:-7px;width:15px;height:15px;border-radius:50%;
        background:${v.color};color:#0a0f1e;font-size:10px;font-weight:800;line-height:15px;
        text-align:center;border:1px solid #0a0f1e">${v.glyph}</div>
    </div>`,
    iconSize: [24, 24], iconAnchor: [12, 22],
  });
}

// Draw project markers (+ optimal site + deviation line for non-good verdicts).
function placeRadarMarkers(projects) {
  radarLayer.clearLayers();
  projects.forEach((p) => {
    if (p.lat == null || p.lon == null) return;
    const color = (SERVICE_META[p.amenityType] || {}).color || "#f59e0b";
    const a = p._audit || { verdict: "unknown", km: null, optimal: null };
    const v = AUDIT[a.verdict];
    const km = a.km == null ? "—" : `${a.km.toFixed(1)} km`;
    const m = L.marker([p.lat, p.lon], { icon: radarPinIcon(color, a.verdict), zIndexOffset: 800 })
      .addTo(radarLayer)
      .bindPopup(
        `<b>${p.projectName}</b><br>${p.buyerName}<br>` +
        `<span style="color:${v.color};font-weight:700">${v.glyph} ${auditLabel(a.verdict)}</span> · ` +
        `${t("radar.popup.fromOptimal", { km })}<br>` +
        (a.optimal
          ? t("radar.popup.modelBest", {
              town: `<b>${a.optimal.nearestTown}</b>`,
              hours: (a.optimal.predictedHoursSaved || 0).toLocaleString(),
            })
          : t("radar.popup.notAudited")));
    p._marker = m;

    // Show the deviation: line to the nearest optimal site + a small optimal marker.
    if (a.optimal && (a.verdict === "review" || a.verdict === "flag")) {
      L.polyline([[p.lat, p.lon], [a.optimal.lat, a.optimal.lon]], {
        color: v.color, weight: 1.5, dashArray: "5 5", opacity: 0.8, interactive: false,
      }).addTo(radarLayer);
      L.circleMarker([a.optimal.lat, a.optimal.lon], {
        radius: 5, color: "#10b981", fillColor: "#10b981", fillOpacity: 0.9, weight: 1,
      }).bindPopup(`<b>★ ${t("radar.popup.optimal")}</b><br>${t("radar.popup.optimalNear", { town: a.optimal.nearestTown })}`).addTo(radarLayer);
    }
  });
}

function radarFeedItem(p) {
  const color = (SERVICE_META[p.amenityType] || {}).color || "#f59e0b";
  const label = svcLabel(p.amenityType);
  const date = (p.scrapedAt || "").slice(0, 10);
  const a = p._audit;
  const v = AUDIT[(a && a.verdict) || "unknown"];
  const auditHtml = a
    ? `<span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded"
         style="background:${v.color}1a;color:${v.color}">${v.glyph} ${auditLabel(a.verdict)}${a.km != null ? ` · ${a.km.toFixed(0)}km` : ""}</span>`
    : `<span class="text-[11px] text-faint">${t("radar.feed.auditing")}</span>`;

  const li = document.createElement("li");
  li.className = "metric-card !p-4 cursor-pointer hover:border-amber-400/50 transition";
  li.dataset.pn = p.procurementNumber;
  li.innerHTML =
    `<div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm font-medium text-slate-100 leading-snug">${p.projectName}</div>
        <div class="text-xs text-muted mt-1">${p.buyerName}</div>
      </div>
      <span class="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md"
            style="background:${color}1a;color:${color}">
        <span class="w-2 h-2 rounded-full" style="background:${color}"></span>${label}</span>
    </div>
    <div class="flex items-center justify-between mt-3">
      ${auditHtml}
      <span class="text-[11px] text-faint tabular-nums">${t("radar.feed.ref", { num: p.procurementNumber, date })}</span>
    </div>`;
  li.addEventListener("click", () => flyToProject(p));
  return li;
}

function renderRadar(data) {
  const feed = $("radarFeed");
  feed.innerHTML = "";
  setText("radarTotal", data.total || 0, { decimals: 0 });
  setText("radarBuyers", new Set(data.projects.map((p) => p.buyerName)).size, { decimals: 0 });

  if (!data.available) {
    feed.innerHTML = `<li class="metric-card text-sm text-muted">${t("radar.status.empty")}</li>`;
    $("radarStatus").textContent = t("radar.status.emptyShort");
    return;
  }
  if (!data.projects.length) {
    feed.innerHTML = `<li class="metric-card text-sm text-muted">${t("radar.status.nomatch")}</li>`;
    $("radarStatus").textContent = "";
    return;
  }
  data.projects.forEach((p) => feed.appendChild(radarFeedItem(p)));
  revealStagger("#radarFeed li", { y: 8, duration: 0.4, stagger: 0.05 });
}

function flyToProject(p) {
  if (p.lat == null || p.lon == null) return;
  map.flyTo([p.lat, p.lon], 12, { duration: 0.8 });
  if (p._marker) p._marker.openPopup();
}

let radarProjects = [];
let radarData = null;        // keep last payload so a locale switch can re-render
async function loadRadar(amenity) {
  const statusEl = $("radarStatus");
  statusEl.textContent = t("radar.status.loading");
  radarLayer.clearLayers();
  try {
    const q = amenity && amenity !== "all" ? `?amenity=${encodeURIComponent(amenity)}` : "";
    const res = await Auth.apiFetch(`${API_BASE_URL}/planned-projects${q}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    radarData = data;
    radarProjects = data.projects || [];
    renderRadar(data);                       // fast first paint (badges show "auditing…")

    if (data.available && radarProjects.length) {
      statusEl.textContent = t("radar.status.auditing");
      await Promise.all(radarProjects.map(async (p) => { p._audit = await auditProject(p); }));
      renderRadar(data);                     // re-paint with verdicts
      placeRadarMarkers(radarProjects);
      updateRadarSummary();
    }
  } catch (err) {
    $("radarFeed").innerHTML = "";
    statusEl.textContent = t("radar.status.failed", { err: err.message });
    console.error("loadRadar failed:", err);
  }
}

function updateRadarSummary() {
  if (!radarData || !radarData.available || !radarProjects.length) return;
  const n = (v) => radarProjects.filter((p) => (p._audit || {}).verdict === v).length;
  $("radarStatus").textContent = t("radar.status.summary", { flag: n("flag"), review: n("review"), good: n("good") });
}

// ---------- Map click router (gated by mode) ----------
let mode = null;
map.on("click", (e) => {
  if (mode !== "municipal" && mode !== "personal") return;
  // Reject interactions outside the country — we only have Bulgarian data.
  if (!inBulgaria(e.latlng.lat, e.latlng.lng)) { outOfBoundsPopup(e.latlng); return; }
  if (mode === "municipal") simulateAt(e);
  else if (mode === "personal") dropPersonalPin(e);
});

// ---------- Mode switching ----------
function showLegend(which) {
  show($("legend"), which !== null);
  show($("legendMunicipal"), which === "municipal");
  show($("legendPersonal"), which === "personal");
  show($("legendRadar"), which === "radar");
}

// Dismiss the landing portal with a quick fade before revealing the app.
function dismissLanding(after) {
  const landing = $("landing");
  const reveal = () => { show($("goHomeBtn"), true); after(); };
  if (!gsapOK) { show(landing, false); reveal(); return; }
  gsap.to(landing, {
    autoAlpha: 0, duration: 0.35, ease: "power2.in",
    onComplete: () => { show(landing, false); landing.style.opacity = ""; landing.style.visibility = ""; reveal(); },
  });
}

function enterMunicipal() {
  dismissLanding(() => {
    mode = "municipal";
    show($("municipalPanel"), true);
    show($("personalPanel"), false);
    show($("radarPanel"), false);
    show($("amenityControl"), true);
    show($("layerControl"), true);
    show($("cellsRow"), true);
    $("toggleCells").checked = cellsOn;   // keep the heatmap checkbox in sync with state
    setScope("province");
    setModeLayerDefaults("municipal");
    buildLayerToggles("municipal");
    showLegend("municipal");
    simLayer.clearLayers();
    hideSiteAi();
    personalLayer.clearLayers();
    radarLayer.clearLayers();
    map.invalidateSize();
    loadMatrix();
    revealStagger("#municipalPanel > *");
    pop("#amenityControl", { delay: 0.1 });
    pop("#layerControl", { delay: 0.15 });
    pop("#legend", { delay: 0.2 });
  });
}

function enterPersonal() {
  dismissLanding(() => {
    mode = "personal";
    show($("municipalPanel"), false);
    show($("personalPanel"), true);
    show($("radarPanel"), false);
    show($("amenityControl"), false);
    show($("layerControl"), true);
    show($("cellsRow"), false);     // no choropleth in personal mode
    cellsOn = false;
    setModeLayerDefaults("personal");
    buildLayerToggles("personal");
    showLegend("personal");
    simLayer.clearLayers();
    recoLayer.clearLayers();
    radarLayer.clearLayers();
    // Fresh planner each entry: clear pins, readouts, search fields, comparison.
    personalLayer.clearLayers();
    pins.current = null; pins.prospective = null;
    show($("comparePanel"), false);
    ["pinCurrentReadout", "pinProspectiveReadout"].forEach((id) => {
      const el = $(id); if (el) el.textContent = t("personal.tapHint");
    });
    ["searchCurrent", "searchProspective"].forEach((id) => {
      const el = $(id); if (el) el.value = "";
    });
    const recoList = $("recoResults");
    if (recoList) recoList.innerHTML = "";
    buildNeeds();
    syncLayersToNeeds();           // map shows only the services in the needs filter
    applyPersonalGating();
    updateSuggestAvailability();   // disabled until a prospective home is set
    armPin("current");
    map.invalidateSize();
    loadPersonalStructures();
    ensureTownData().catch(() => {});   // warm the city-search index
    revealStagger("#personalPanel > *");
    pop("#layerControl", { delay: 0.15 });
    pop("#legend", { delay: 0.2 });
  });
}

function enterRadar() {
  dismissLanding(() => {
    mode = "radar";
    show($("municipalPanel"), false);
    show($("personalPanel"), false);
    show($("radarPanel"), true);
    show($("amenityControl"), false);
    show($("layerControl"), false);
    showLegend("radar");
    $("districtName").textContent = t("radar.districtName");
    // Clean slate: Radar shows ONLY project flags + deviation lines (+ country outline).
    simLayer.clearLayers();
    recoLayer.clearLayers();
    personalLayer.clearLayers();
    cellLayer.clearLayers();
    Object.values(serviceLayers).forEach((l) => l.clearLayers());
    cellsOn = false;
    applyLayerVisibility();
    district = "all";
    map.invalidateSize();
    map.setView(MAP_CENTER, MAP_ZOOM);
    hideLoading();          // radar doesn't load the matrix — clear the map overlay
    loadRadar("all");
    $("radarFilter").value = "all";
    revealStagger("#radarPanel > *");
    pop("#legend", { delay: 0.2 });
  });
}

function goHome() {
  mode = null;
  show($("landing"), true);
  show($("goHomeBtn"), false);
  show($("layerControl"), false);
  show($("paidToggle"), false);
  showLegend(null);
  cellsOn = true;   // restore municipal default for next entry
  revealStagger("#landing [data-stagger]", { y: 22, duration: 0.55, stagger: 0.07 });
}

// Gate each lens on role + admin-granted access; pop a paywall instead of entering.
function gateEnter(kind) {
  const u = currentUser;
  if (!u) return false;
  if (u.role === "ADMIN") return true;
  if (kind === "municipal") {
    if (u.role !== "MUNICIPALITY") { Auth.showPaywall("ACCESS_MUNICIPAL"); return false; }
    if (!u.active) { Auth.showPaywall("ACCESS_PENDING"); return false; }
    return true;
  }
  if (kind === "radar") {
    if (u.role !== "REPORTER") { Auth.showPaywall("ACCESS_REPORTER"); return false; }
    if (!u.active) { Auth.showPaywall("ACCESS_PENDING"); return false; }
    return true;
  }
  // personal: free + paid individuals (free is always allowed, just limited)
  if (u.role === "FREE_USER" || u.role === "PAID_USER") return true;
  Auth.showPaywall("ACCESS_PERSONAL");
  return false;
}

$("enterMunicipal").addEventListener("click", () => { if (gateEnter("municipal")) enterMunicipal(); });
$("enterPersonal").addEventListener("click", () => { if (gateEnter("personal")) enterPersonal(); });
$("enterRadar").addEventListener("click", () => { if (gateEnter("radar")) enterRadar(); });
$("goHomeBtn").addEventListener("click", goHome);
$("recommendBtn").addEventListener("click", recommendSites);
$("pinCurrentBtn").addEventListener("click", () => armPin("current"));
$("pinProspectiveBtn").addEventListener("click", () => armPin("prospective"));

// "I own a car" toggle: restore the saved choice (default on) and recompute on change.
(function wireCarToggle() {
  const el = $("ownsCar");
  if (!el) return;
  try { const v = localStorage.getItem(CAR_KEY); if (v !== null) el.checked = v === "1"; } catch { /* ignore */ }
  el.addEventListener("change", () => {
    try { localStorage.setItem(CAR_KEY, el.checked ? "1" : "0"); } catch { /* ignore */ }
    if (mode !== "personal") return;
    if (personalIsFree()) { if (pins.current && pins.prospective) setPersonalStatus("personal.toggleHint"); return; }
    if (pins.current && pins.prospective) runCompare();
  });
})();
$("radarFilter").addEventListener("change", (e) => loadRadar(e.target.value));
$("suggestBtn").addEventListener("click", suggestAreas);
$("quotaUpgradeBtn").addEventListener("click", () => Auth.showPaywall("PAYWALL_QUOTA"));
$("aiExplainLocked").addEventListener("click", () => Auth.showPaywall("PAYWALL_UPGRADE"));
$("paidToggleInput").addEventListener("change", (e) => onDemoPaidToggle(e.target.checked));

// Admin demo toggle: re-skin the personal lens (filters, layers, paid extras) in place.
function onDemoPaidToggle(on) {
  setDemoPaid(on);
  buildNeeds();
  buildLayerToggles("personal");
  applyPersonalGating();
  if (lastCompareData) renderAiExplanation(lastCompareData);
}

// ---------- Role-aware landing + personal-panel gating ----------
Auth.onReady((user) => applyRoleGating(user));

// Re-skin the UI in place after a self-serve paywall "payment" unlocks a tier —
// without bouncing the user back to the portal (goHome) like a fresh session does.
Auth.onActivated((user) => {
  currentUser = user;
  showLensButtons(user.role);
  if (mode === "personal") {
    buildNeeds();
    buildLayerToggles("personal");
    applyPersonalGating();
    if (lastCompareData) renderAiExplanation(lastCompareData);
  }
});

function showLensButtons(role) {
  show($("enterMunicipal"), role === "ADMIN" || role === "MUNICIPALITY");
  show($("enterPersonal"),  role === "ADMIN" || role === "FREE_USER" || role === "PAID_USER");
  show($("enterRadar"),     role === "ADMIN" || role === "REPORTER");
}

function applyRoleGating(user) {
  currentUser = user;
  showLensButtons(user.role);
  goHome();   // a fresh session always lands on the (now role-filtered) portal
}

// Configure the personal panel for the current account (quota meter, paid extras).
function applyPersonalGating() {
  const free = personalIsFree();
  const paid = personalIsPaid();
  // Demo paid/free toggle is an admin-only preview tool.
  show($("paidToggle"), isAdmin());
  const ti = $("paidToggleInput");
  if (ti) ti.checked = demoPaid;
  show($("quotaBadge"), free);
  if (free) {
    // Admin demo resets to a full allowance; real free users keep their server count.
    const rem = (currentUser.role === "ADMIN" || currentUser.freeGuessesRemaining == null)
      ? currentUser.freeGuessLimit : currentUser.freeGuessesRemaining;
    updateQuotaBadge(rem);
  }
  // Suggest button: unlock for paid/admin, lock (icon) for free.
  const lock = $("suggestBtn").querySelector("span");
  if (lock) lock.textContent = paid ? "✨" : "🔒";
  // Reset the per-comparison cards.
  show($("aiExplainCard"), false);
  show($("aiExplainLocked"), false);
  $("suggestResults").innerHTML = "";
  updateSuggestAvailability();
}

// "Suggest best areas" only makes sense once a prospective home is set — keep the
// button disabled until then (a fetch in flight sets data-busy to hold it down).
function updateSuggestAvailability() {
  const btn = $("suggestBtn");
  if (!btn || btn.dataset.busy === "1") return;
  btn.disabled = !pins.prospective;
}

function updateQuotaBadge(remaining) {
  const r = $("quotaRemaining"), l = $("quotaLimit");
  if (r) r.textContent = remaining;
  if (l && currentUser) l.textContent = currentUser.freeGuessLimit;
  if (currentUser) currentUser.freeGuessesRemaining = remaining;
}

// AI explanation (tier 1) vs locked teaser (free). Honours the demo toggle, so
// the admin can preview the locked state even though the backend returned text.
function renderAiExplanation(data) {
  if (personalIsPaid() && data && data.aiExplanation) {
    $("aiExplainText").textContent = data.aiExplanation;
    show($("aiExplainCard"), true);
    show($("aiExplainLocked"), false);
  } else if (personalIsFree()) {
    show($("aiExplainCard"), false);
    show($("aiExplainLocked"), true);
  } else {
    show($("aiExplainCard"), false);
    show($("aiExplainLocked"), false);
  }
}

// ---------- Personal: suggest best areas (tier 1 paid) ----------
async function suggestAreas() {
  if (!personalIsPaid()) { Auth.showPaywall("PAYWALL_UPGRADE"); return; }
  if (!pins.prospective) { setPersonalStatus("suggest.needProspective"); return; }
  if (!pins.current) { setPersonalStatus("suggest.needPin"); return; }
  const btn = $("suggestBtn");
  const list = $("suggestResults");
  btn.dataset.busy = "1";
  btn.disabled = true;
  list.innerHTML = "";
  recoLayer.clearLayers();
  setPersonalStatus("suggest.asking");
  try {
    const c = pins.current.getLatLng();
    const res = await Auth.apiFetch(`${API_BASE_URL}/personal-suggest?top=5`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentLat: c.lat, currentLon: c.lng, householdProfile: { needs: selectedNeeds(), hasCar: ownsCar() } }),
    });
    const data = await res.json();
    const pts = [];
    (data.suggestions || []).forEach((s, i) => {
      const rank = i + 1;
      pts.push([s.lat, s.lon]);
      L.marker([s.lat, s.lon], { icon: recoIcon(rank), zIndexOffset: 1000 })
        .addTo(recoLayer)
        .bindPopup(`<b>${t("suggest.popup")} #${rank}</b><br>${s.settlement}` +
                   `<br>${s.weeklyHours.toFixed(1)} ${t("unit.h").trim()}/wk`);
      const li = document.createElement("li");
      li.className = "flex items-start gap-2";
      li.innerHTML =
        `<span class="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-emerald-950 text-xs font-bold">${rank}</span>` +
        `<span><b>${s.settlement}</b> — ${s.weeklyHours.toFixed(1)} ${t("unit.h").trim()}/wk` +
        (s.hoursSavedVsCurrent > 0.05
          ? `<span class="text-emerald-400"> (−${s.hoursSavedVsCurrent.toFixed(1)} ${t("suggest.saved")})</span>` : "") +
        `</span>`;
      list.appendChild(li);
    });
    revealStagger("#suggestResults li", { y: 8, duration: 0.4, stagger: 0.06 });
    if (pts.length) {
      map.fitBounds(L.latLngBounds(pts.concat([[pins.current.getLatLng().lat, pins.current.getLatLng().lng]])), { padding: [50, 50], maxZoom: 11 });
      setPersonalStatus("suggest.result", { n: pts.length });
    } else {
      setPersonalStatus("suggest.none");
    }
  } catch (err) {
    if (!err.paywall) setPersonalStatus("suggest.failed", { err: err.message });
  } finally {
    btn.dataset.busy = "";
    updateSuggestAvailability();
  }
}

// ---------- Scope picker: provinces vs towns ----------
// Latin labels everywhere so the region + city pickers read in one script.
const districtLabel = (d) => (!d || d === "all") ? "All Bulgaria" : d;

// The 28 provinces (Latin, matching the DB) + the nationwide option.
const REGIONS = ["all", "Blagoevgrad", "Burgas", "Dobrich", "Gabrovo", "Haskovo", "Kardzhali",
  "Kyustendil", "Lovech", "Montana", "Pazardzhik", "Pernik", "Pleven", "Plovdiv", "Razgrad",
  "Ruse", "Shumen", "Silistra", "Sliven", "Smolyan", "Sofia (Capital)", "Sofia Province",
  "Stara Zagora", "Targovishte", "Varna", "Veliko Tarnovo", "Vidin", "Vratsa", "Yambol"];

const regionInput = $("regionInput");
const cityInput = $("cityInput");
let selectedCity = null;   // town-scope: the picked city, so Recommend centres on it

// Generic search combobox: text input + suggestion list, Cyrillic/Latin aware.
function makeCombo({ input, list, minChars, allOnFocus, getItems, onPick }) {
  if (!input || !list) return;
  let matches = [], active = -1;
  const close = () => { list.classList.add("hidden"); list.innerHTML = ""; active = -1; };
  const paint = () => [...list.children].forEach((li, i) =>
    li.firstElementChild.classList.toggle("bg-panel2", i === active));
  const render = () => {
    if (!matches.length) { close(); return; }
    list.innerHTML = matches.map((m, i) =>
      `<li><button type="button" data-i="${i}"
         class="w-full text-left px-3 py-1.5 text-sm text-slate-100 hover:bg-panel2 transition flex items-baseline gap-2">
         <span>${m.label}</span>${m.right ? `<span class="text-[11px] text-faint">${m.right}</span>` : ""}
       </button></li>`).join("");
    active = -1;
    list.classList.remove("hidden");
  };
  const run = async (showAll) => {
    const raw = input.value.trim();
    if (!showAll && raw.length < minChars) { close(); return; }
    let items;
    try { items = await getItems(); } catch { return; }
    if (showAll || !raw) { matches = items.slice(0, 60); render(); return; }
    if (raw.length < minChars) { close(); return; }   // value changed during await
    const q = searchKey(raw);
    const pre = [], sub = [];
    for (const it of items) {
      if (it.key.startsWith(q)) pre.push(it);
      else if (it.key.includes(q)) sub.push(it);
    }
    matches = pre.concat(sub).slice(0, 8);
    render();
  };
  const choose = (i) => { const it = matches[i]; if (!it) return; close(); onPick(it); };
  input.addEventListener("input", () => run(false));
  input.addEventListener("focus", () => {
    if (allOnFocus && !input.value.trim()) run(true);
    else if (input.value.trim().length >= minChars) run(false);
  });
  input.addEventListener("keydown", (e) => {
    if (list.classList.contains("hidden")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, matches.length - 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active < 0 ? 0 : active); }
    else if (e.key === "Escape") { close(); }
  });
  // mousedown (not click) so the pick registers before the input's blur closes the list.
  list.addEventListener("mousedown", (e) => {
    const btn = e.target.closest("button[data-i]");
    if (btn) { e.preventDefault(); choose(+btn.dataset.i); }
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
}

function setDistrict(d) {
  district = d;
  selectedCity = null;   // region picked → recommend over the whole province
  $("districtName").textContent = districtLabel(d);
  recoLayer.clearLayers();
  $("recoResults").innerHTML = "";
  hideSiteAi();
  loadMatrix();
}

// Region combobox — shows all provinces on focus; search in Cyrillic or Latin.
makeCombo({
  input: regionInput, list: $("regionSuggest"), minChars: 0, allOnFocus: true,
  getItems: () => REGIONS.map((d) => ({ label: districtLabel(d), key: searchKey(districtLabel(d)), value: d })),
  onPick: (it) => { regionInput.value = it.label; setDistrict(it.value); },
});

// City combobox — type 3+ letters (Cyrillic or Latin); flies the map to the town.
makeCombo({
  input: cityInput, list: $("citySuggest"), minChars: 3, allOnFocus: false,
  getItems: async () => (await ensureTownData()).map((tw) => ({
    label: tw.settlement, key: tw._key,
    right: (tw.district && tw.district !== tw.settlement) ? tw.district : "", data: tw,
  })),
  onPick: (it) => {
    const tw = it.data;
    cityInput.value = tw.settlement;
    selectedCity = { lat: tw.lat, lon: tw.lon, district: tw.district, name: tw.settlement };
    $("districtName").textContent = tw.settlement;
    // New focus → stale recommendations no longer apply.
    recoLayer.clearLayers();
    $("recoResults").innerHTML = "";
    hideSiteAi();
    map.flyTo([tw.lat, tw.lon], 12, { duration: 0.8 });
    L.popup().setLatLng([tw.lat, tw.lon]).setContent(`<b>${tw.settlement}</b>`).openOn(map);
  },
});

// Default to the nationwide view, like the old <select>'s "All Bulgaria".
district = "all";
if (regionInput) regionInput.value = districtLabel("all");

let scope = "province";
function setScope(s) {
  scope = s;
  selectedCity = null;   // fresh scope → no city centred yet
  const prov = s === "province";
  for (const [btn, active] of [["scopeProvince", prov], ["scopeTown", !prov]]) {
    const el = $(btn);
    el.classList.toggle("bg-accent/15", active);
    el.classList.toggle("text-accent", active);
    el.classList.toggle("text-muted", !active);
  }
  show($("regionCombo"), prov);
  show($("cityCombo"), !prov);
  if (prov) {
    if (regionInput) regionInput.value = districtLabel(district);
    $("districtName").textContent = districtLabel(district);
  } else {
    ensureTownData().catch(() => {});     // warm the city-search index
    if (cityInput) cityInput.value = "";
    if (district !== "all") {             // towns are nationwide — widen the matrix
      district = "all";
      recoLayer.clearLayers();
      $("recoResults").innerHTML = "";
      loadMatrix();
    }
  }
}

// Bulgarian Cyrillic → Latin (Streamlined System, as used by GeoNames) so the
// city search matches whether the user types "Пловдив" or "Plovdiv".
const BG_TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
  т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht",
  ъ: "a", ь: "y", ю: "yu", я: "ya",
};
function translitBg(s) {
  let out = "";
  for (const ch of s.toLowerCase()) out += (BG_TRANSLIT[ch] || ch);
  return out;
}
// A forgiving key for matching: transliterate, fold y→i and collapse doubled
// letters so "София" → "sofia" lines up with the GeoNames spelling "Sofia".
const searchKey = (s) => translitBg(s).replace(/y/g, "i").replace(/(.)\1+/g, "$1");

// Town index derived from the nationwide matrix (one entry per settlement, the
// max-population cell). Shared by the municipal town picker and the personal
// residence search; built once and cached.
let townData = null;     // [{ settlement, lat, lon, district, _key }]
async function ensureTownData() {
  if (townData) return townData;
  const data = await fetchMatrix("all");
  const byName = {};
  data.cells.forEach((c) => {
    if (!c.settlement) return;
    const cur = byName[c.settlement];
    if (!cur || c.population > cur.population) byName[c.settlement] = c;
  });
  townData = Object.values(byName)
    .map((c) => ({ settlement: c.settlement, lat: c.lat, lon: c.lon, district: c.district, _key: searchKey(c.settlement) }))
    .sort((a, b) => a.settlement.localeCompare(b.settlement));
  return townData;
}

$("scopeProvince").addEventListener("click", () => setScope("province"));
$("scopeTown").addEventListener("click", () => setScope("town"));

// ---------- Personal residence search (city autocomplete → pin + fly) ----------
function selectCity(which, town) {
  placePin(which, L.latLng(town.lat, town.lon));
  $(which === "current" ? "pinCurrentReadout" : "pinProspectiveReadout").textContent =
    (town.district && town.district !== town.settlement)
      ? `${town.settlement}, ${town.district}` : town.settlement;
  map.flyTo([town.lat, town.lon], 12, { duration: 0.8 });
  if (which === "current" && !pins.prospective) armPin("prospective");
  if (pins.current && pins.prospective) runCompare();
}

function wireCitySearch(which) {
  const input = $(which === "current" ? "searchCurrent" : "searchProspective");
  const list = $(which === "current" ? "suggestCurrent" : "suggestProspective");
  if (!input || !list) return;
  let matches = [];
  let active = -1;
  const close = () => { list.classList.add("hidden"); list.innerHTML = ""; active = -1; };
  const paint = () => [...list.children].forEach((li, i) =>
    li.firstElementChild.classList.toggle("bg-panel2", i === active));
  const render = () => {
    if (!matches.length) { close(); return; }
    list.innerHTML = matches.map((tw, i) =>
      `<li><button type="button" data-i="${i}"
         class="w-full text-left px-3 py-1.5 text-sm text-slate-100 hover:bg-panel2 transition flex items-baseline gap-2">
         <span>${tw.settlement}</span>${(tw.district && tw.district !== tw.settlement)
           ? `<span class="text-[11px] text-faint">${tw.district}</span>` : ""}
       </button></li>`).join("");
    active = -1;
    list.classList.remove("hidden");
  };
  const search = async () => {
    const raw = input.value.trim();
    if (raw.length < 2) { close(); return; }
    let data;
    try { data = await ensureTownData(); } catch { return; }
    const q = searchKey(raw);   // Cyrillic or Latin → same comparison key
    // Prefix hits first, then any substring — reads more naturally than a raw filter.
    const pre = [], sub = [];
    for (const tw of data) {
      if (tw._key.startsWith(q)) pre.push(tw);
      else if (tw._key.includes(q)) sub.push(tw);
    }
    matches = pre.concat(sub).slice(0, 8);
    render();
  };
  const choose = (i) => {
    const tw = matches[i];
    if (!tw) return;
    input.value = tw.settlement;
    close();
    selectCity(which, tw);
  };
  input.addEventListener("input", search);
  input.addEventListener("focus", () => { if (input.value.trim().length >= 2) search(); });
  input.addEventListener("keydown", (e) => {
    if (list.classList.contains("hidden")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, matches.length - 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active < 0 ? 0 : active); }
    else if (e.key === "Escape") { close(); }
  });
  // mousedown (not click) so the pick registers before the input's blur closes the list.
  list.addEventListener("mousedown", (e) => {
    const btn = e.target.closest("button[data-i]");
    if (btn) { e.preventDefault(); choose(+btn.dataset.i); }
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
}
wireCitySearch("current");
wireCitySearch("prospective");

// ---------- Live locale switch ----------
// I18n.setLocale() already re-translated every [data-i18n] node (including the
// province + amenity <option> text). Here we only patch the bits JS owns, so the
// switch is instant and never reloads — and user state (selections, pins) is kept.
I18n.onChange(() => {
  // District readout is set dynamically, not via data-i18n.
  if (mode === "radar") {
    $("districtName").textContent = t("radar.districtName");
  } else if (scope === "province") {
    $("districtName").textContent = districtLabel(district);
  }
  // Radar feed + markers embed localized labels; re-render in place (audits cached).
  if (mode === "radar" && radarData) {
    renderRadar(radarData);
    if (radarData.available && radarProjects.length) {
      placeRadarMarkers(radarProjects);
      updateRadarSummary();
    }
  }
  // Layer toggles embed localized service names; layerState is preserved on rebuild.
  if (mode === "municipal" || mode === "personal") buildLayerToggles(mode);

  // Personal need rows: relabel in place to keep each checkbox's state.
  document.querySelectorAll("#needsList label[data-need]").forEach((row) => {
    const key = row.dataset.need;
    const lab = row.querySelector(".need-label");
    const hint = row.querySelector(".need-hint");
    const soon = row.querySelector(".need-soon");
    if (lab) lab.textContent = t("need." + key);
    if (hint) hint.textContent = t("needHint." + key);
    if (soon) soon.textContent = t("need.soon");
  });

  // Re-render the last transient lines + the efficiency badge in the new language.
  if (lastStatus) setStatus(lastStatus.key, lastStatus.params);
  if (lastPersonalStatus) setPersonalStatus(lastPersonalStatus.key, lastPersonalStatus.params);
  renderEfficiencyBadge();
});
