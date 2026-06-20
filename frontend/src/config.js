window.TPM = {
  API_BASE_URL: "http://localhost:8080/api/v1/time-poverty",
  ML_BASE_URL: "http://localhost:8000/api/ml",   // Python ML sidecar (placement + travel-time bots)
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

  // Single source of truth for every service type: colour, label, which demographic
  // group it serves, and whether its layer is drawn by default. Pharmacies are the
  // largest set (1,620) so they start hidden to keep the first view readable.
  SERVICE_META: {
    kindergarten: { label: "Kindergartens", color: "#38bdf8", group: "children_0_6", on: true },
    school:       { label: "Schools",       color: "#818cf8", group: "children_0_6", on: true },
    clinic:       { label: "Clinics",       color: "#fb923c", group: "seniors_65p",  on: true },
    hospital:     { label: "Hospitals",     color: "#f87171", group: "seniors_65p",  on: true },
    pharmacy:     { label: "Pharmacies",    color: "#34d399", group: "seniors_65p",  on: false },
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
};
