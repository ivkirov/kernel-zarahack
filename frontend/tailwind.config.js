/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.js"],
  theme: {
    extend: {
      // Semantic palette driven by CSS variables so a single class on <html>
      // (default = dark; `.theme-maps` = Google-Maps light) re-skins everything.
      // Variable RGB triplets live in src/input.css.
      colors: {
        base:    "rgb(var(--c-base) / <alpha-value>)",    // page background
        panel:   "rgb(var(--c-panel) / <alpha-value>)",   // card background
        panel2:  "rgb(var(--c-panel2) / <alpha-value>)",  // recessed surface
        edge:    "rgb(var(--c-edge) / <alpha-value>)",    // borders
        accent:  "rgb(var(--c-accent) / <alpha-value>)",  // interactive / municipal
        accent2: "rgb(var(--c-accent2) / <alpha-value>)", // personal / positive
        warn:    "rgb(var(--c-warn) / <alpha-value>)",    // high time poverty
        good:    "rgb(var(--c-good) / <alpha-value>)",    // hours saved
        muted:   "rgb(var(--c-muted) / <alpha-value>)",   // secondary text
        faint:   "rgb(var(--c-faint) / <alpha-value>)",   // tertiary text
        ink:     "rgb(var(--c-ink) / <alpha-value>)",     // primary text (theme-aware)
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
