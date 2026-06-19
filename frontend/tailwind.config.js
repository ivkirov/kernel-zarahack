/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.js"],
  theme: {
    extend: {
      colors: {
        base:    "#0b1020",   // page background
        panel:   "#121a2e",   // card background
        edge:    "#1f2a44",   // borders
        accent:  "#38bdf8",   // cyan — interactive
        warn:    "#f97316",   // orange — high time poverty
        good:    "#22c55e",   // green — hours saved
        muted:   "#94a3b8",
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
