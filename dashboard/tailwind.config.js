// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Geist for UI chrome, JetBrains Mono for telemetry data
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      colors: {
        // Extend zinc scale with a warm tint for the retail brand
        brand: {
          50:  "#f0fdf4",
          500: "#10b981",
          700: "#047857",
          900: "#064e3b",
        },
      },
    },
  },
  plugins: [],
};
