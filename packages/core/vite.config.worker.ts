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

type ClientManifest = Record<string, { file?: string; imports?: string[] }>;

/** The client build manifest, or null before the client has been built. */
function readClientManifest(): ClientManifest | null {
  const manifestPath = resolve(dir, "dist/client/.vite/manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf-8")) as ClientManifest;
  } catch {
    return null;
  }
}

function toAssetPath(file: string): string {
  return `${ASSET_BASE_PATH}/${file.replace(/^_assets\//, "")}`;
}

/**
 * Read the client build manifest to get a content-hashed asset file path.
 * Returns a `/_assets/<fallbackName><ext>` fallback when the manifest is not yet built.
 */
function readClientManifestFile(
  entryKey: string,
  fallbackName: string,
  ext: string,
): string {
  const file = readClientManifest()?.[entryKey]?.file;
  return file ? toAssetPath(file) : `${ASSET_BASE_PATH}/${fallbackName}${ext}`;
}

/**
 * Every file a page has to fetch before an entry can run: the entry chunk and,
 * transitively, the chunks it imports statically. The layout emits these as
 * `modulepreload` links so an entry loaded on demand is already cached when
 * it is needed — browsers do not reliably preload a module's own imports.
 */
function readClientManifestPreload(
  entryKey: string,
  fallbackName: string,
): string[] {
  const manifest = readClientManifest();
  if (!manifest?.[entryKey]?.file) {
    return [`${ASSET_BASE_PATH}/${fallbackName}.js`];
  }
  const files: string[] = [];
  const seen = new Set<string>();
  const pending = [entryKey];
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk?.file) continue;
    files.push(toAssetPath(chunk.file));
    pending.push(...(chunk.imports ?? []));
  }
  return files;
}

const clientJsFile = readClientManifestFile("src/client.ts", "client", ".js");
const clientAuthJsFile = readClientManifestFile(
  "src/client-auth.ts",
  "client-auth",
  ".js",
);
const clientComposePreload = readClientManifestPreload(
  "src/client-compose.ts",
  "client-compose",
);
const clientCssFile = readClientManifestFile("src/style.css", "client", ".css");
const clientAuthCssFile = readClientManifestFile(
  "src/style-author.css",
  "client-author",
  ".css",
);
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
    __CLIENT_COMPOSE_PRELOAD__: JSON.stringify(clientComposePreload),
    __CLIENT_CSS_FILE__: JSON.stringify(clientCssFile),
    __CLIENT_AUTHOR_CSS_FILE__: JSON.stringify(clientAuthCssFile),
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
