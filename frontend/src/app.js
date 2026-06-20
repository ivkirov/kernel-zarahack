const {
  API_BASE_URL, ML_BASE_URL, DISTRICT, MAP_CENTER, MAP_ZOOM,
  COLORS, SERVICE_META, PERSONAL_NEEDS, MATRIX_CACHE_TTL,
} = window.TPM;

// Active municipal district; "all" = whole country. Mutable via the province picker.
let district = DISTRICT;

// ---------- Leaflet init ----------
// preferCanvas keeps the nationwide view (~17k vector layers) smooth.
const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView(MAP_CENTER, MAP_ZOOM);
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "© OpenStreetMap, © CARTO",
  maxZoom: 19,
}).addTo(map);

// One layer group per service type so filtering is a cheap add/remove (no redraw).
const serviceLayers = {};
Object.keys(SERVICE_META).forEach((t) => (serviceLayers[t] = L.layerGroup()));

const cellLayer = L.layerGroup().addTo(map);
const simLayer  = L.layerGroup().addTo(map);
const personalLayer = L.layerGroup().addTo(map);
const recoLayer = L.layerGroup().addTo(map);   // AI placement recommendations

// Visibility state (mirrors SERVICE_META defaults + the choropleth toggle).
const layerState = {};
Object.entries(SERVICE_META).forEach(([t, m]) => (layerState[t] = m.on));
let cellsOn = true;

// Keep Leaflet sized to its container when the layout reflows (responsive stack).
window.addEventListener("resize", () => map.invalidateSize());

const $ = (id) => document.getElementById(id);
function show(el, visible) { el && el.classList.toggle("hidden", !visible); }

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

  const res = await fetch(`${API_BASE_URL}/matrix?district=${encodeURIComponent(d)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  memCache[d] = data;
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch { /* quota */ }
  return data;
}

// ---------- Drawing ----------
function nodePopup(n) {
  const meta = SERVICE_META[n.serviceType] || {};
  return `<b>${n.name || meta.label || n.serviceType}</b><br>${n.serviceType}`;
}
function drawNodes(nodes) {
  Object.values(serviceLayers).forEach((l) => l.clearLayers());
  nodes.forEach((n) => {
    const meta = SERVICE_META[n.serviceType];
    const layer = serviceLayers[n.serviceType];
    if (!layer) return;
    L.circleMarker([n.lat, n.lon], {
      radius: 4, color: meta.color, fillColor: meta.color, fillOpacity: 0.9, weight: 1,
    }).bindPopup(nodePopup(n)).addTo(layer);
  });
  applyLayerVisibility();
}
function drawCells(cells) {
  cellLayer.clearLayers();
  cells.forEach((c) => {
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
function buildLayerToggles() {
  const box = $("layerToggles");
  box.innerHTML = "";
  Object.entries(SERVICE_META).forEach(([type, m]) => {
    const row = document.createElement("label");
    row.className = "flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer";
    row.innerHTML =
      `<input type="checkbox" id="lyr_${type}" ${layerState[type] ? "checked" : ""} class="accent-accent w-3.5 h-3.5"/>` +
      `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${m.color}"></span>${m.label}`;
    box.appendChild(row);
    row.querySelector("input").addEventListener("change", (e) => {
      layerState[type] = e.target.checked;
      applyLayerVisibility();
    });
  });
}
buildLayerToggles();

$("toggleCells").addEventListener("change", (e) => { cellsOn = e.target.checked; applyLayerVisibility(); });

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
  const statusEl = $("status");
  showLoading("Loading the time-poverty matrix…");
  statusEl.textContent = "Loading matrix…";
  try {
    const data = await fetchMatrix(district);
    drawNodes(data.nodes);
    drawCells(data.cells);
    setText("systemicHours", data.totalAnnualWastedHours, { decimals: 0 });
    statusEl.textContent = `Loaded ${data.nodes.length} services, ${data.cells.length} cells.`;
    const pts = [];
    data.nodes.forEach((n) => pts.push([n.lat, n.lon]));
    data.cells.forEach((c) => pts.push([c.lat, c.lon]));
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [25, 25] });
  } catch (err) {
    statusEl.textContent = `Failed to load matrix: ${err.message}`;
    console.error("loadMatrix failed:", err);
  } finally {
    hideLoading();
  }
}

// Personal mode still wants structures on the map — reuse the cached nationwide nodes,
// but no choropleth (cells are a municipal concept).
async function loadPersonalStructures() {
  showLoading("Loading nearby services…");
  try {
    const data = await fetchMatrix("all");
    drawNodes(data.nodes);
    cellLayer.clearLayers();
  } catch (err) {
    $("personalStatus").textContent = `Failed to load services: ${err.message}`;
    console.error("loadPersonalStructures failed:", err);
  } finally {
    hideLoading();
  }
}

// ---------- Municipal: click → simulate ----------
async function simulateAt(e) {
  const amenityType = $("amenitySelect").value;
  const payload = { district, lat: e.latlng.lat, lon: e.latlng.lng, amenityType };

  simLayer.clearLayers();
  L.marker([payload.lat, payload.lon]).addTo(simLayer)
    .bindPopup(`Simulated ${amenityType}`).openPopup();

  $("status").textContent = "Simulating intervention…";

  const res = await fetch(`${API_BASE_URL}/simulate`, {
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

  $("status").textContent =
    `Intervention would save ${sim.annualWastedHoursSaved.toLocaleString()} hours/year.`;
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
  const statusEl = $("status");

  btn.disabled = true;
  statusEl.textContent = "Asking the AI model for the best build sites…";
  list.innerHTML = "";
  recoLayer.clearLayers();

  try {
    const url = `${ML_BASE_URL}/recommend?amenity=${encodeURIComponent(amenity)}`
              + `&district=${encodeURIComponent(district)}&top=3`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const pts = [];
    data.recommendations.forEach((r, i) => {
      const rank = i + 1;
      pts.push([r.lat, r.lon]);
      L.marker([r.lat, r.lon], { icon: recoIcon(rank), zIndexOffset: 1000 })
        .addTo(recoLayer)
        .bindPopup(`<b>★ Recommended site #${rank}</b><br>` +
                   `Build: ${data.amenity}<br>Near: ${r.nearestTown}<br>` +
                   `Predicted: <b>${r.predictedHoursSaved.toLocaleString()}</b> h/yr saved`);

      const li = document.createElement("li");
      li.className = "flex items-start gap-2";
      li.innerHTML =
        `<span class="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full
          bg-emerald-500 text-emerald-950 text-xs font-bold">${rank}</span>` +
        `<span><b>${r.nearestTown}</b> — ${r.predictedHoursSaved.toLocaleString()} h/yr` +
        `<span class="text-muted"> saved</span></span>`;
      list.appendChild(li);
    });
    revealStagger("#recoResults li", { y: 8, duration: 0.4, stagger: 0.08 });

    if (pts.length) {
      map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 11 });
      statusEl.textContent = `AI recommends ${pts.length} site(s) for a new ${data.amenity}.`;
    } else {
      statusEl.textContent = "No high-impact sites found for this selection.";
    }
  } catch (err) {
    statusEl.textContent = `Recommendation failed: ${err.message}`;
    console.error("recommendSites failed:", err);
  } finally {
    btn.disabled = false;
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

function armPin(which) {
  armedPin = which;
  $("pinCurrentBtn").classList.toggle("border-rose-500", which === "current");
  $("pinProspectiveBtn").classList.toggle("border-emerald-400", which === "prospective");
}

function placePin(which, latlng) {
  if (pins[which]) personalLayer.removeLayer(pins[which]);
  pins[which] = L.marker(latlng, { icon: pinIcon(PIN_COLORS[which]) }).addTo(personalLayer);
  const label = which === "current" ? "Current" : "Prospective";
  pins[which].bindPopup(`${label} residence`);
  $(which === "current" ? "pinCurrentReadout" : "pinProspectiveReadout")
    .textContent = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
}

async function dropPersonalPin(e) {
  placePin(armedPin, e.latlng);
  if (armedPin === "current" && !pins.prospective) armPin("prospective");
  if (pins.current && pins.prospective) await runCompare();
}

// ---------- Personal needs UI ----------
const NEED_DEFAULT = new Set(["kindergarten", "school", "clinic", "pharmacy"]);
function buildNeeds() {
  const box = $("needsList");
  box.innerHTML = "";
  PERSONAL_NEEDS.forEach((n) => {
    const color = (SERVICE_META[n.key] || {}).color || "#8ea2c0";
    const row = document.createElement("label");
    row.className = "flex items-center justify-between gap-2 rounded-lg border border-edge bg-panel2 " +
      "px-3 py-2 cursor-pointer hover:border-accent2/60 transition";
    row.innerHTML =
      `<span class="flex items-center gap-2.5 text-sm">
        <input type="checkbox" data-need="${n.key}" ${NEED_DEFAULT.has(n.key) ? "checked" : ""} class="accent-accent2 w-4 h-4"/>
        <span class="w-2.5 h-2.5 rounded-full" style="background:${color}"></span>${n.label}</span>
      <span class="text-[11px] text-faint">${n.hint}</span>`;
    box.appendChild(row);
    const cb = row.querySelector("input");
    cb.addEventListener("change", () => {
      if (cb.checked) setLayerVisible(n.key, true);   // show what you're comparing
      runCompare();
    });
  });
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
    const li = document.createElement("li");
    li.className = "flex items-center justify-between gap-2";
    li.innerHTML =
      `<span class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full shrink-0" style="background:${color}"></span>${key}</span>
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
    householdProfile: { needs: selectedNeeds() },
  };

  $("personalStatus").textContent = "Calculating your time-tax…";
  const res = await fetch(`${API_BASE_URL}/personal-compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  show($("comparePanel"), true);
  setText("currentWeekly", data.currentWeeklyHours, { decimals: 1 });
  setText("prospectiveWeekly", data.prospectiveWeeklyHours, { decimals: 1 });
  renderBreakdown(data.currentBreakdown, data.prospectiveBreakdown);

  const shift = data.efficiencyShiftHours;
  const badge = $("efficiencyShift");
  badge.classList.remove("text-emerald-400", "text-rose-500");
  if (data.gain) {
    badge.classList.add("text-emerald-400");
    badge.textContent = `+${shift.toFixed(1)} h returned / week`;
  } else {
    badge.classList.add("text-rose-500");
    badge.textContent = `${shift.toFixed(1)} h / week`;
  }
  const needCount = selectedNeeds().length;
  $("personalStatus").textContent =
    `Compared across ${needCount || "all"} need${needCount === 1 ? "" : "s"} using nationwide services.`;
}

// ---------- Map click router (gated by mode) ----------
let mode = null;
map.on("click", (e) => {
  if (mode === "municipal") simulateAt(e);
  else if (mode === "personal") dropPersonalPin(e);
});

// ---------- Mode switching ----------
function showLegend(which) {
  show($("legend"), which !== null);
  show($("legendMunicipal"), which === "municipal");
  show($("legendPersonal"), which === "personal");
}

// Dismiss the landing portal with a quick fade before revealing the app.
function dismissLanding(after) {
  const landing = $("landing");
  if (!gsapOK) { show(landing, false); after(); return; }
  gsap.to(landing, {
    autoAlpha: 0, duration: 0.35, ease: "power2.in",
    onComplete: () => { show(landing, false); landing.style.opacity = ""; landing.style.visibility = ""; after(); },
  });
}

function enterMunicipal() {
  dismissLanding(() => {
    mode = "municipal";
    show($("municipalPanel"), true);
    show($("personalPanel"), false);
    show($("amenityControl"), true);
    show($("layerControl"), true);
    show($("cellsRow"), true);
    showLegend("municipal");
    personalLayer.clearLayers();
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
    show($("amenityControl"), false);
    show($("layerControl"), true);
    show($("cellsRow"), false);     // no choropleth in personal mode
    cellsOn = false;
    showLegend("personal");
    simLayer.clearLayers();
    recoLayer.clearLayers();
    const recoList = $("recoResults");
    if (recoList) recoList.innerHTML = "";
    buildNeeds();
    armPin("current");
    map.invalidateSize();
    loadPersonalStructures();
    revealStagger("#personalPanel > *");
    pop("#layerControl", { delay: 0.15 });
    pop("#legend", { delay: 0.2 });
  });
}

function goHome() {
  mode = null;
  show($("landing"), true);
  show($("layerControl"), false);
  showLegend(null);
  cellsOn = true;   // restore municipal default for next entry
  revealStagger("#landing [data-stagger]", { y: 22, duration: 0.55, stagger: 0.07 });
}

$("enterMunicipal").addEventListener("click", enterMunicipal);
$("enterPersonal").addEventListener("click", enterPersonal);
$("goHomeBtn").addEventListener("click", goHome);
$("recommendBtn").addEventListener("click", recommendSites);
$("pinCurrentBtn").addEventListener("click", () => armPin("current"));
$("pinProspectiveBtn").addEventListener("click", () => armPin("prospective"));

// ---------- Province picker (municipal) ----------
const districtLabel = (d) => (!d || d === "all") ? "All Bulgaria" : d;
const districtSelect = $("districtSelect");
if (districtSelect) {
  district = districtSelect.value;
  $("districtName").textContent = districtLabel(district);
  districtSelect.addEventListener("change", (e) => {
    district = e.target.value;
    $("districtName").textContent = districtLabel(district);
    recoLayer.clearLayers();
    $("recoResults").innerHTML = "";
    loadMatrix();
  });
}
