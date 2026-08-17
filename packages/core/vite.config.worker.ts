/**
 * Library build: bundles the shared app entry plus the Node runtime entry.
 *
 * Run via: `vite build --config vite.config.worker.ts`
 *
 * External dependencies (hono, drizzle-orm, etc.) are preserved as imports.
 * Internal imports (including @jant/core/i18n from SWC Lingui rewrites) are
 * resolved via package.json exports and bundled inline.
 */

import { defineConfig } from "vite";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { ASSET_BASE_PATH } from "./src/lib/asset-path.js";
import { buildVersion, pkg, swcPlugin } from "./vite.shared";

const dir = import.meta.dirname;

/**
 * Read the client build manifest to get a content-hashed asset file path.
 * Returns a `/_assets/<fallbackName><ext>` fallback when the manifest is not yet built.
 */
function readClientManifestFile(
  entryKey: string,
  fallbackName: string,
  ext: string,
): string {
  const manifestPath = resolve(dir, "dist/client/.vite/manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(
        readFileSync(manifestPath, "utf-8"),
      ) as Record<string, { file?: string }>;
      const file = manifest[entryKey]?.file;
      if (file) return `${ASSET_BASE_PATH}/${file.replace(/^_assets\//, "")}`;
    } catch {
      // Fall through to default
    }
  }
  return `${ASSET_BASE_PATH}/${fallbackName}${ext}`;
}

const clientJsFile = readClientManifestFile("src/client.ts", "client", ".js");
const clientAuthJsFile = readClientManifestFile(
  "src/client-auth.ts",
  "client-auth",
  ".js",
);
const clientCssFile = readClientManifestFile("src/style.css", "client", ".css");
const clientCjkCssFile = readClientManifestFile(
  "src/style-cjk.css",
  "client-cjk",
  ".css",
);
const clientCjkTcCssFile = readClientManifestFile(
  "src/style-cjk-tc.css",
  "client-cjk-tc",
  ".css",
);
const clientCjkJpCssFile = readClientManifestFile(
  "src/style-cjk-jp.css",
  "client-cjk-jp",
  ".css",
);
const clientCjkKrCssFile = readClientManifestFile(
  "src/style-cjk-kr.css",
  "client-cjk-kr",
  ".css",
);

export default defineConfig({
  // SWC handles the server/library transforms in this build.
  oxc: false,

  define: {
    __JANT_VERSION__: JSON.stringify(buildVersion),
    __CLIENT_JS_FILE__: JSON.stringify(clientJsFile),
    __CLIENT_AUTH_JS_FILE__: JSON.stringify(clientAuthJsFile),
    __CLIENT_CSS_FILE__: JSON.stringify(clientCssFile),
    __CLIENT_CJK_CSS_FILE__: JSON.stringify(clientCjkCssFile),
    __CLIENT_CJK_TC_CSS_FILE__: JSON.stringify(clientCjkTcCssFile),
    __CLIENT_CJK_JP_CSS_FILE__: JSON.stringify(clientCjkJpCssFile),
    __CLIENT_CJK_KR_CSS_FILE__: JSON.stringify(clientCjkKrCssFile),
    // __JANT_DEV__ intentionally omitted — typeof check evaluates to false
  },

  build: {
    lib: {
      entry: {
        index: resolve(dir, "src/index.ts"),
        node: resolve(dir, "src/node/index.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: (id: string) => {
        if (id.startsWith("@jant/core")) return false; // bundle internal modules
        if (id.startsWith("node:")) return true;
        if (id.startsWith("cloudflare:")) return true;
        if (id === "__STATIC_CONTENT_MANIFEST") return true;
        // Bundled, not external: limax pulls in pinyin-pro, whose module scope
        // has to stay free of the async scheduling Workers reject at deploy
        // time (see the pinyin-pro override in pnpm-workspace.yaml). Freezing
        // the version we tested into dist keeps every self-hosted deploy on
        // it, whatever the consumer's package manager would resolve.
        if (id === "limax" || id.startsWith("limax/")) return false;
        return Object.keys(pkg.dependencies ?? {}).some(
          (dep: string) => id === dep || id.startsWith(dep + "/"),
        );
      },
    },
    target: "esnext",
    minify: false,
    // Do not wipe the outDir — client assets live in dist/client/ (a
    // subdirectory) and must not be deleted when the lib rebuilds.
    // The lib emits fixed-name entry files that overwrite in-place.
    emptyOutDir: false,
  },

  plugins: [swcPlugin()],
});
