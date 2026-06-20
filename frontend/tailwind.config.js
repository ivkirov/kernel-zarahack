/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.js"],
  theme: {
    extend: {
      colors: {
        base:    "#0a0f1e",   // page background (deep ink-navy)
        panel:   "#111a30",   // card background
        panel2:  "#0e1528",   // recessed surface
        edge:    "#21304f",   // borders
        accent:  "#38bdf8",   // cyan — interactive / municipal
        accent2: "#34d399",   // emerald — personal / positive
        warn:    "#fb923c",   // orange — high time poverty
        good:    "#22c55e",   // green — hours saved
        muted:   "#8ea2c0",   // secondary text (cool gray)
        faint:   "#5b6c8a",   // tertiary text
      },
      fontFamily: {
        sans:    ["Inter", "system-ui", "sans-serif"],
        display: ["'Space Grotesk'", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        // tinted to the navy base instead of pure black
        card:   "0 1px 0 0 rgba(255,255,255,.03) inset, 0 12px 30px -12px rgba(3,8,20,.8)",
        glow:   "0 0 0 1px rgba(56,189,248,.25), 0 0 40px -8px rgba(56,189,248,.35)",
        glowEm: "0 0 0 1px rgba(52,211,153,.25), 0 0 40px -8px rgba(52,211,153,.35)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(rgba(56,189,248,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,.04) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};
