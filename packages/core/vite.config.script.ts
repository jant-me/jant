/**
 * Dev-script runner (`node dev/run-script.mjs <script> [args...]`).
 *
 * TypeScript dev scripts import `src/` directly, and `src/` is written for this
 * pipeline rather than for Node: shared modules declare their strings with the
 * Lingui macro, which exists only after the SWC transform, and read `define`
 * globals at module scope. This config compiles a script and everything it
 * imports the way the builds do — SSR only, with no HTTP server, HMR, or file
 * watching.
 */

import { resolve } from "node:path";
import { defineConfig } from "vite";
import {
  buildVersion,
  swcPlugin,
  unbuiltClientAssetDefine,
} from "./vite.shared.ts";

export default defineConfig({
  root: resolve(import.meta.dirname),
  appType: "custom",
  // A script reads its own env file; Vite's `.env` loading is for the client.
  envDir: false,
  logLevel: "warn",
  // SWC owns the transforms; disable Vite 8's default Oxc layer.
  oxc: false,

  server: {
    middlewareMode: true,
    hmr: false,
    ws: false,
    watch: null,
  },

  optimizeDeps: { noDiscovery: true },

  define: {
    __JANT_VERSION__: JSON.stringify(buildVersion),
    ...unbuiltClientAssetDefine,
    // __JANT_DEV__ omitted, as in the library build: a script stands in for the
    // built CLI, not for the dev server.
  },

  plugins: [swcPlugin()],
});
