window.TPM = {
  API_BASE_URL: "http://localhost:8080/api/v1/time-poverty",
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
};
