export default {
  content: ["./frontend/index.html", "./frontend/src/**/*.{vue,js}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
      colors: {
        ink: "#12201f",
        mist: "#f4fbf8",
        ocean: "#0f9ea8",
        primary: "#86efac",
        "primary-hover": "#6ee7a0",
        leaf: "#16a34a",
        iris: "#4f5bd5",
        honey: "#e4a11b",
        coral: "#e55757",
        "night-page": "#0f1115",
        "night-sidebar": "#12151b",
        "night-surface": "#171a21",
        "night-elevated": "#1d222b",
        "night-border": "#2a303b",
      },
      boxShadow: {
        soft: "0 18px 50px rgba(18, 32, 31, 0.08)",
      },
    },
  },
  plugins: [],
};
