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

// ---------- Animated counter (requestAnimationFrame) ----------
function animateCounter(el, to, { decimals = 0, suffix = "" } = {}) {
  const from = parseFloat(el.dataset.val || "0");
  const start = performance.now();
  const dur = 900;
  function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);             // easeOutCubic
    const val = from + (to - from) * eased;
    el.firstChild
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

// ---------- Click → simulate ----------
map.on("click", async (e) => {
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
});

loadMatrix();
