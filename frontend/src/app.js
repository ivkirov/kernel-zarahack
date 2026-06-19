const { API_BASE_URL, DISTRICT, MAP_CENTER, MAP_ZOOM, COLORS } = window.TPM;

// ---------- Leaflet init over the pilot city ----------
const map = L.map("map", { zoomControl: true }).setView(MAP_CENTER, MAP_ZOOM);
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "© OpenStreetMap, © CARTO",
  maxZoom: 19,
}).addTo(map);

const nodeLayer = L.layerGroup().addTo(map);
const cellLayer = L.layerGroup().addTo(map);
const simLayer  = L.layerGroup().addTo(map);
const personalLayer = L.layerGroup().addTo(map);

// ---------- Animated counter (requestAnimationFrame) ----------
function animateCounter(el, to, { decimals = 0, suffix = "" } = {}) {
  const from = parseFloat(el.dataset.val || "0");
  const start = performance.now();
  const dur = 900;
  function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);             // easeOutCubic
    const val = from + (to - from) * eased;
    el.childNodes[0]
      ? (el.childNodes[0].nodeValue = val.toLocaleString(undefined,
          { maximumFractionDigits: decimals }) )
      : (el.textContent = val.toFixed(decimals));
    if (t < 1) requestAnimationFrame(frame);
    else el.dataset.val = String(to);
  }
  el.dataset.val = el.dataset.val || "0";
  requestAnimationFrame(frame);
}

function setText(id, value, opts) {
  animateCounter(document.getElementById(id), value, opts);
}

// ---------- Color ramp for time-poverty choropleth ----------
function povertyColor(minutes) {
  if (minutes > 30) return "#7f1d1d";
  if (minutes > 20) return "#b91c1c";
  if (minutes > 12) return "#f97316";
  if (minutes > 6)  return "#facc15";
  return "#22c55e";
}

// ---------- Load baseline matrix ----------
async function loadMatrix() {
  document.getElementById("status").textContent = "Loading matrix…";
  const res = await fetch(`${API_BASE_URL}/matrix?district=${encodeURIComponent(DISTRICT)}`);
  const data = await res.json();

  nodeLayer.clearLayers();
  cellLayer.clearLayers();

  // Existing service nodes
  data.nodes.forEach(n => {
    L.circleMarker([n.lat, n.lon], {
      radius: 5, color: COLORS[n.serviceType] || "#94a3b8",
      fillOpacity: 0.9, weight: 1,
    }).bindPopup(`<b>${n.name || n.serviceType}</b><br>${n.serviceType}`)
      .addTo(nodeLayer);
  });

  // Time-poverty cells (sized by population, colored by nearest travel time)
  data.cells.forEach(c => {
    L.circle([c.lat, c.lon], {
      radius: 120 + Math.sqrt(c.population) * 25,
      color: povertyColor(c.nearestMinutes),
      fillColor: povertyColor(c.nearestMinutes),
      fillOpacity: 0.25, weight: 1,
    }).bindPopup(
      `<b>${c.settlement}</b><br>${c.groupKey}<br>` +
      `Pop: ${c.population}<br>Nearest: ${c.nearestMinutes.toFixed(1)} min<br>` +
      `Time-Poverty Score: ${c.timePovertyScore.toFixed(0)}`
    ).addTo(cellLayer);
  });

  setText("systemicHours", data.totalAnnualWastedHours, { decimals: 0 });
  document.getElementById("status").textContent =
    `Loaded ${data.nodes.length} services, ${data.cells.length} cells.`;
}

// ---------- Municipal: click → simulate ----------
async function simulateAt(e) {
  const amenityType = document.getElementById("amenitySelect").value;
  const payload = {
    district: DISTRICT,
    lat: e.latlng.lat,
    lon: e.latlng.lng,
    amenityType,
  };

  // Drop a marker for the simulated node
  simLayer.clearLayers();
  L.marker([payload.lat, payload.lon]).addTo(simLayer)
    .bindPopup(`Simulated ${amenityType}`).openPopup();

  document.getElementById("status").textContent = "Simulating intervention…";

  const res = await fetch(`${API_BASE_URL}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const sim = await res.json();

  // Animate the HUD
  setText("hoursSaved", sim.annualWastedHoursSaved, { decimals: 0 });
  setText("peopleImpacted", sim.peopleImpacted, { decimals: 0 });
  setText("cellsImproved", sim.affectedCells, { decimals: 0 });
  setText("avgMinutes", sim.minutesSavedPerTripAvg, { decimals: 1 });

  // Shade improved cells green
  sim.deltas.forEach(d => {
    L.circle([d.lat, d.lon], {
      radius: 120 + Math.sqrt(d.population) * 25,
      color: COLORS.simulated, fillColor: COLORS.simulated,
      fillOpacity: 0.35, weight: 1,
    }).bindPopup(
      `${d.beforeMinutes.toFixed(1)} → ${d.afterMinutes.toFixed(1)} min<br>` +
      `Saves ${d.hoursSavedAnnual.toFixed(0)} h/yr`
    ).addTo(simLayer);
  });

  document.getElementById("status").textContent =
    `Intervention would save ${sim.annualWastedHoursSaved.toLocaleString()} hours/year.`;
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
  document.getElementById("pinCurrentBtn")
    .classList.toggle("border-rose-500", which === "current");
  document.getElementById("pinProspectiveBtn")
    .classList.toggle("border-emerald-400", which === "prospective");
}

function placePin(which, latlng) {
  if (pins[which]) personalLayer.removeLayer(pins[which]);
  pins[which] = L.marker(latlng, { icon: pinIcon(PIN_COLORS[which]) }).addTo(personalLayer);
  const label = which === "current" ? "Current" : "Prospective";
  pins[which].bindPopup(`${label} residence`);
  document.getElementById(which === "current" ? "pinCurrentReadout" : "pinProspectiveReadout")
    .textContent = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
}

async function dropPersonalPin(e) {
  placePin(armedPin, e.latlng);
  // After placing current, auto-arm prospective for a smooth flow.
  if (armedPin === "current" && !pins.prospective) armPin("prospective");
  if (pins.current && pins.prospective) await runCompare();
}

async function runCompare() {
  if (!pins.current || !pins.prospective) return;
  const c = pins.current.getLatLng();
  const p = pins.prospective.getLatLng();
  const payload = {
    currentLat: c.lat, currentLon: c.lng,
    prospectiveLat: p.lat, prospectiveLon: p.lng,
    householdProfile: {
      hasChildren: document.getElementById("hasChildren").checked,
      needsSeniorCare: document.getElementById("needsSeniorCare").checked,
    },
  };

  document.getElementById("personalStatus").textContent = "Calculating your time-tax…";
  const res = await fetch(`${API_BASE_URL}/personal-compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  document.getElementById("comparePanel").classList.remove("hidden");
  setText("currentWeekly", data.currentWeeklyHours, { decimals: 1 });
  setText("prospectiveWeekly", data.prospectiveWeeklyHours, { decimals: 1 });

  const shift = data.efficiencyShiftHours;
  const badge = document.getElementById("efficiencyShift");
  badge.classList.remove("text-emerald-400", "text-rose-500");
  if (data.gain) {
    badge.classList.add("text-emerald-400");
    badge.textContent = `Time Efficiency Gain: +${shift.toFixed(1)} Hours Returned/Week`;
  } else {
    badge.classList.add("text-rose-500");
    badge.textContent = `Time Efficiency Loss: ${shift.toFixed(1)} Hours/Week`;
  }
  document.getElementById("personalStatus").textContent =
    `Compared against ${DISTRICT} services for your selected needs.`;
}

// ---------- Map click router (gated by mode) ----------
let mode = null;
map.on("click", (e) => {
  if (mode === "municipal") simulateAt(e);
  else if (mode === "personal") dropPersonalPin(e);
});

// ---------- Mode switching ----------
let matrixLoaded = false;
const $ = (id) => document.getElementById(id);

function show(el, visible) { el.classList.toggle("hidden", !visible); }

function enterMunicipal() {
  mode = "municipal";
  show($("landing"), false);
  show($("municipalPanel"), true);
  show($("personalPanel"), false);
  show($("amenityControl"), true);
  personalLayer.clearLayers();
  map.invalidateSize();
  if (!matrixLoaded) { loadMatrix(); matrixLoaded = true; }
}

function enterPersonal() {
  mode = "personal";
  show($("landing"), false);
  show($("municipalPanel"), false);
  show($("personalPanel"), true);
  show($("amenityControl"), false);
  nodeLayer.clearLayers();
  cellLayer.clearLayers();
  simLayer.clearLayers();
  armPin("current");
  map.invalidateSize();
}

function goHome() {
  mode = null;
  show($("landing"), true);
}

$("enterMunicipal").addEventListener("click", enterMunicipal);
$("enterPersonal").addEventListener("click", enterPersonal);
$("goHomeBtn").addEventListener("click", goHome);
$("pinCurrentBtn").addEventListener("click", () => armPin("current"));
$("pinProspectiveBtn").addEventListener("click", () => armPin("prospective"));
$("hasChildren").addEventListener("change", runCompare);
$("needsSeniorCare").addEventListener("change", runCompare);
