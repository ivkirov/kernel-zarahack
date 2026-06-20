// Resolve the API origin for a given backend port. Locally the page is on
// localhost so we hit localhost:<port>. Behind the OpenKBS vs2 proxy the page
// host looks like "7001-p-<id>.vs2.openkbs.com"; the same backend is reachable
// at "<port>-p-<id>.vs2.openkbs.com" over https — swap the leading port prefix.
const _apiOrigin = (port) => {
  const h = window.location.hostname;
  return /^\d+-/.test(h) && h.endsWith(".openkbs.com")
    ? `${window.location.protocol}//${h.replace(/^\d+-/, port + "-")}`
    : `http://localhost:${port}`;
};
const _API = _apiOrigin(8080);
const _ML = _apiOrigin(8000);

window.TPM = {
  API_BASE_URL: `${_API}/api/v1/time-poverty`,
  AUTH_BASE_URL: `${_API}/api/v1/auth`,   // register / login / me
  ADMIN_BASE_URL: `${_API}/api/v1/admin`,  // admin user management
  ML_BASE_URL: `${_ML}/api/ml`,   // Python ML sidecar (placement + travel-time bots)

  // Amenities a FREE_USER may filter/compare by. Everything else is shown-but-locked
  // behind the paywall. Mirrors the backend's Features.FREE_ALLOWED_AMENITIES.
  FREE_ALLOWED_AMENITIES: ["school", "clinic", "hospital", "pharmacy"],

  // Future personal-only filters (no data yet) — shown disabled behind an extra
  // paywall for everyone but admin, per the tier-1 "additional filters" add-on.
  FUTURE_NEEDS: [
    { key: "gym",    color: "#a78bfa" },
    { key: "barber", color: "#f472b6" },
  ],
  DISTRICT: "all",            // default municipal view: whole country (switchable in the picker)
  // Bulgaria center (the map auto-fits to the loaded district on entry)
  MAP_CENTER: [42.73, 25.48],
  MAP_ZOOM: 7,
  COLORS: {
    kindergarten: "#38bdf8",
    school:       "#818cf8",
    hospital:     "#f87171",
    clinic:       "#fb923c",
    pharmacy:     "#34d399",
    simulated:    "#22c55e",
  },

  // Single source of truth for every service type: colour, which demographic group
  // it serves, and whether its layer is drawn by default. Pharmacies are the
  // largest set (1,620) so they start hidden to keep the first view readable.
  // NB: the user-facing `label`/`hint` strings below are now localized in i18n.js
  // (keys `svc.*`, `need.*`, `needHint.*`); the ones here are inert fallbacks.
  SERVICE_META: {
    kindergarten: { label: "Kindergartens", color: "#38bdf8", group: "children_0_6", on: true },
    school:       { label: "Schools",       color: "#818cf8", group: "children_0_6", on: true },
    clinic:       { label: "Clinics",       color: "#fb923c", group: "seniors_65p",  on: true },
    hospital:     { label: "Hospitals",     color: "#f87171", group: "seniors_65p",  on: true },
    // Pharmacies are personal-mode only (too dense + not a planning lever for municipalities).
    pharmacy:     { label: "Pharmacies",    color: "#34d399", group: "seniors_65p",  on: true, personalOnly: true },
  },

  // Fine-grained needs for the personal planner (sent to /personal-compare as `needs`).
  PERSONAL_NEEDS: [
    { key: "kindergarten", label: "Kindergarten", hint: "daily drop-off" },
    { key: "school",       label: "School",       hint: "daily run" },
    { key: "clinic",       label: "Clinic / GP",  hint: "check-ups" },
    { key: "hospital",     label: "Hospital",     hint: "occasional" },
    { key: "pharmacy",     label: "Pharmacy",     hint: "weekly" },
  ],

  // Local matrix cache: skip refetch within this window (ms) per district.
  MATRIX_CACHE_TTL: 1000 * 60 * 30,   // 30 min

  // Geofencing: we only have Bulgarian data. Clamp panning + gate clicks to here.
  BG_BOUNDS: [[41.0, 22.0], [44.4, 28.9]],   // [[south,west],[north,east]] (padded)
  BG_OUTLINE_URL: "./data/bulgaria.json",     // outer rings for outline + point-in-country test
  OUT_OF_BOUNDS_MSG: "We currently only have data for Bulgaria.",
};
