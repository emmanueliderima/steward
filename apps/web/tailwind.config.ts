import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0A0D0C",
        surface: "#121613",
        "surface-2": "#181D19",
        hairline: "#262E29",
        "text-hi": "#EAF0EC",
        "text-lo": "#8FA098",
        // Semantic states — these carry real meaning from the contract's
        // own logic (executed / reverted / pending), not decoration.
        executed: "#5EEAD4",
        "executed-dim": "#1F3A35",
        pending: "#E8B75E",
        "pending-dim": "#3A2F1A",
        reverted: "#E85E5E",
        "reverted-dim": "#3A1F1F",
        // Marks AI-authored content specifically, distinct from the
        // chain's own verdict colors above.
        ai: "#9B8CFF",
        "ai-dim": "#241F3A",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "ui-sans-serif", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;