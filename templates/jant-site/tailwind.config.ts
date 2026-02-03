import type { Config } from "tailwindcss";
import { jantPlugin } from "@jant/core/plugin";

export default {
  // User only needs to care about their own code
  content: ["./src/**/*.{ts,tsx}"],
  // Load plugin: plugin will auto-inject @jant/core's absolute path
  plugins: [jantPlugin],
} satisfies Config;
