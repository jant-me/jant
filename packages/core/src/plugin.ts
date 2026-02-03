import plugin from "tailwindcss/plugin";
import type { Config } from "tailwindcss";
import path from "path";
import { createRequire } from "module";

// Get require method (ESM compatible)
const require = createRequire(import.meta.url);

// ---------------------------------------------------------
// Core Logic: Dynamically resolve absolute path
// ---------------------------------------------------------
// 1. Penetrate pnpm symlinks, find the real physical location of package.json
const pathRoot = path.dirname(require.resolve("@jant/core/package.json"));

// 2. Construct the absolute path to the source directory
// Tailwind v4 scans absolute paths reliably, no extra config needed
const contentPath = path.join(pathRoot, "src/**/*.{ts,tsx}");

export const jantPlugin: NonNullable<Config["plugins"]>[number] = plugin(
  // Plugin body: can add styles via addBase/addComponents here
  () => {},
  {
    // Key: Auto-inject core library source path into user's content config
    content: [contentPath],
  }
);
