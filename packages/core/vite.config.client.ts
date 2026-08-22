/**
 * Client asset build: produces public/auth JS plus shared CSS assets.
 *
 * Run via: `vite build --config vite.config.client.ts`
 *
 * These assets are served via wrangler [assets] in user projects.
 * Public pages load the lean bundle; authenticated pages opt into the heavier
 * editor/admin bundle.
 */

import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { buildVersion, clientBuildOptions, clientPlugins } from "./vite.shared";

export default defineConfig({
  // Keep Vite's base at `/`. Asset URLs already include the reserved
  // namespace via rollup output paths; setting `base` would prefix them twice.
  build: {
    ...clientBuildOptions,
    // Keep fonts and other assets as real files so CSP can stay at
    // `font-src 'self'` without needing `data:`.
    assetsInlineLimit: 0,
    emptyOutDir: true,
    minify: true,
    // Manifest maps entry source paths → hashed output filenames so the
    // Worker build can embed the correct content-addressed paths.
    manifest: true,
  },

  define: {
    __JANT_VERSION__: JSON.stringify(buildVersion),
  },

  plugins: [tailwindcss(), clientPlugins()],
});
