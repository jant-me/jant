/**
 * Static-site client build.
 *
 * Produces a single self-contained JS + CSS pair used by the Hugo static-site
 * export. Output lands at `src/services/export-theme/assets/client-site.{js,css}`
 * so the worker build can inline the bytes via `?raw` imports and ship them as
 * `static/_jant/client-site.{js,css}` in the generated theme.
 *
 * Runs independently of the main client build because the static-site bundle
 * needs to be a single self-contained entry, not code-split across shared
 * chunks. Using one bundle file avoids relative-path drift when the theme is
 * copied to third-party Hugo sites.
 */

import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { CLIENT_TARGET, clientPlugins } from "./vite.shared";

const dir = import.meta.dirname;

export default defineConfig({
  build: {
    outDir: "src/services/export-theme/assets",
    target: CLIENT_TARGET,
    emptyOutDir: true,
    minify: true,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        "client-site": resolve(dir, "src/client-site.ts"),
      },
      // Single self-contained bundle — no code-splitting or chunk files.
      output: {
        codeSplitting: false,
        entryFileNames: "[name].js",
        // Rename the extracted stylesheet from Vite's default `style.css`
        // to `client-site.css` so the theme reference stays stable.
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === "style.css") return "client-site.css";
          return "[name][extname]";
        },
      },
    },
  },

  plugins: [tailwindcss(), clientPlugins()],
});
