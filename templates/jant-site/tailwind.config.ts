import type { Config } from "tailwindcss";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// Dynamically find @jant/core's physical path
// Works in both monorepo and node_modules scenarios
const jantCorePath = path.dirname(require.resolve("@jant/core/package.json"));

export default {
  content: [
    "./src/**/*.{ts,tsx}",
    // Absolute path ensures Tailwind can always find the files
    path.join(jantCorePath, "src/**/*.{ts,tsx}"),
  ],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
