/**
 * Shared Vite configuration used by all three config files.
 *
 * Exports:
 * - pkg: package.json data (version, dependencies)
 * - buildVersion: cache-busting version token for deployed assets
 * - CLIENT_TARGET: browser target for client asset compilation
 * - clientBuildOptions: rollup input/output for public/auth JS and CSS assets
 * - swcPlugin: SWC with Hono JSX + Lingui macro transforms
 * - clientPlugins: the transform stack and build guard both browser bundles use
 * - enforceClientBundleBudget: keeps heavy packages lazy and entry bundles
 *   under their gzipped byte budgets
 */

import type { Plugin } from "vite";
import swc from "unplugin-swc";
import { resolve } from "path";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { gzipSync } from "zlib";
import {
  ASSET_BASE_SEGMENT,
  ASSET_CHUNK_SEGMENT,
} from "./src/lib/asset-path.js";

const dir = import.meta.dirname;

export const pkg = JSON.parse(
  readFileSync(resolve(dir, "package.json"), "utf-8"),
);

function resolveRawBuildId(): string {
  const fromEnv = (process.env.JANT_BUILD_ID ?? "").trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

const rawBuildId = resolveRawBuildId();
const safeBuildId = rawBuildId.replace(/[^0-9A-Za-z._-]/g, "").slice(0, 16);

/**
 * Deployed assets are cached as immutable, so semver alone is not a stable
 * cache-buster for hosted builds that ship unreleased commits.
 */
export const buildVersion = safeBuildId
  ? `${pkg.version}-${safeBuildId}`
  : pkg.version;

/** Browser target for client assets. */
export const CLIENT_TARGET = "es2022" as const;

/**
 * Client asset build options.
 *
 * Produces:
 * - `client.js` for public-page interactions
 * - `client-auth.js`, the shell for authenticated pages
 * - `client-compose.js`, `client-settings.js`, `client-manage.js`, loaded by
 *   the shell on demand (see `src/client/lazy-entries.ts`)
 * - `client.css` for the shared site styles
 * - `client-author.css`, the composer/settings/editor styles, linked only on
 *   authenticated pages
 * - `client-cjk.css` for optional Simplified Chinese font assets
 * - `client-cjk-tc.css` for optional Traditional Chinese font assets
 * - `client-cjk-jp.css` for optional Japanese font assets
 * - `client-cjk-kr.css` for optional Korean font assets
 */
export const clientBuildOptions = {
  outDir: "dist/client",
  target: CLIENT_TARGET,
  rollupOptions: {
    input: {
      client: resolve(dir, "src/client.ts"),
      "client-auth": resolve(dir, "src/client-auth.ts"),
      "client-compose": resolve(dir, "src/client-compose.ts"),
      "client-settings": resolve(dir, "src/client-settings.ts"),
      "client-manage": resolve(dir, "src/client-manage.ts"),
      style: resolve(dir, "src/style.css"),
      "style-author": resolve(dir, "src/style-author.css"),
      "style-cjk": resolve(dir, "src/style-cjk.css"),
      "style-cjk-tc": resolve(dir, "src/style-cjk-tc.css"),
      "style-cjk-jp": resolve(dir, "src/style-cjk-jp.css"),
      "style-cjk-kr": resolve(dir, "src/style-cjk-kr.css"),
    },
    output: {
      // Content-hashed entry names so cross-bundle ES module imports always
      // resolve to the correct version. Without hashes, the bare ./client.js
      // import in client-auth.js hits the immutably-cached old file after a
      // deploy that changes the shared exports.
      entryFileNames: `${ASSET_BASE_SEGMENT}/[name]-[hash].js`,
      // Name the on-demand chunks after their package. Rolldown otherwise
      // names a chunk after its first module's directory, which for
      // mediabunny's `dist/modules/src/index.js` is `src-<hash>.js`.
      advancedChunks: {
        groups: [
          { name: "mediabunny", test: /node_modules\/mediabunny\// },
          {
            name: "emoji-mart",
            test: /node_modules\/(emoji-mart|@emoji-mart)\//,
          },
        ],
      },
      chunkFileNames: `${ASSET_BASE_SEGMENT}/${ASSET_CHUNK_SEGMENT}/[name]-[hash].js`,
      assetFileNames: (assetInfo) => {
        switch (assetInfo.name) {
          case "style.css":
            return `${ASSET_BASE_SEGMENT}/client-[hash].css`;
          case "style-author.css":
            return `${ASSET_BASE_SEGMENT}/client-author-[hash].css`;
          case "style-cjk.css":
            return `${ASSET_BASE_SEGMENT}/client-cjk-[hash].css`;
          case "style-cjk-tc.css":
            return `${ASSET_BASE_SEGMENT}/client-cjk-tc-[hash].css`;
          case "style-cjk-jp.css":
            return `${ASSET_BASE_SEGMENT}/client-cjk-jp-[hash].css`;
          case "style-cjk-kr.css":
            return `${ASSET_BASE_SEGMENT}/client-cjk-kr-[hash].css`;
          default:
            return `${ASSET_BASE_SEGMENT}/${ASSET_CHUNK_SEGMENT}/[name]-[hash][extname]`;
        }
      },
    },
  },
};

/**
 * Worker bundle options for the browser builds.
 *
 * `image-worker.ts` comes in through `?worker&inline`, so Vite compiles it as
 * a bundle of its own: SWC has to run there as well, and ES output keeps it
 * the same kind of module as the rest of the client.
 */
export const workerBuildOptions = {
  format: "es" as const,
  plugins: () => [swcPlugin()],
};

/**
 * SWC plugin for Hono JSX transforms and Lingui macro rewrites.
 *
 * Every bundle needs it, browser bundles included: `lib/` modules are shared
 * between the worker and the client, and some of them declare their
 * reader-facing strings with the Lingui macro.
 */
export const swcPlugin = () =>
  swc.vite({
    // The dev server hands a worker's source over as
    // `image-worker.ts?worker_file&type=module`. unplugin-swc's default filter
    // stops at the extension, so without this the browser is sent TypeScript
    // and the worker dies on its first line.
    include: /\.m?[jt]sx?(\?worker_file\b.*)?$/,
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      transform: {
        react: {
          runtime: "automatic",
          importSource: "hono/jsx",
          throwIfNamespace: false,
        },
      },
      target: "esnext",
      experimental: {
        plugins: [
          [
            "@lingui/swc-plugin",
            {
              runtimeModules: {
                useLingui: ["@jant/core/i18n", "useLingui"],
                trans: ["@jant/core/i18n", "Trans"],
              },
            },
          ],
        ],
      },
    },
    module: { type: "es6" },
  });

/**
 * Everything the two browser bundles (`vite.config.client.ts`,
 * `vite.config.site.ts`) need beyond their own entry points.
 *
 * One export rather than a list each config assembles itself, because that is
 * exactly how the client build lost the Lingui transform: `lib/` modules are
 * shared with the worker, some declare their strings with the Lingui macro, and
 * a browser build without SWC leaves `@lingui/core/macro` standing in the graph
 * — where it resolves to a Babel plugin whose own `babel-plugin-macros` import
 * resolves to nothing. See {@link failOnUnresolvedImport} for why that shipped.
 */
export const clientPlugins = (): Plugin[] => [
  {
    // Vite 8 transforms with Oxc by default. SWC owns the transform here, and
    // running both over the same file is one pass too many.
    name: "jant:client-oxc-off",
    config: () => ({ oxc: false as const }),
  },
  swcPlugin(),
  failOnUnresolvedImport(),
];

/** Rolldown's stand-in for a module it could not resolve. */
const UNRESOLVED_STUB =
  /Could not resolve "([^"]+)" imported by "([^"]+)"\. Is it installed\?/g;

/**
 * Fails the build when a chunk carries a module that only throws.
 *
 * An import nothing resolves does not stop a rolldown build: the missing module
 * is replaced by one that throws when the browser evaluates it, and the build
 * still exits 0. Nothing is logged — a `require()` inside a CJS dependency does
 * not even reach `onLog` — so the first report is a blank page and a stack
 * trace in someone's console, with every custom element after the throw
 * silently unregistered. Read the emitted chunks instead, where the stub is
 * unambiguous, and fail there.
 */
function failOnUnresolvedImport(): Plugin {
  return {
    name: "jant:fail-on-unresolved-import",
    generateBundle(_options, bundle) {
      const unresolved = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const [, missing, importer] of chunk.code.matchAll(
          UNRESOLVED_STUB,
        )) {
          unresolved.add(`  "${missing}" imported by "${importer}"`);
        }
      }
      if (unresolved.size === 0) return;
      throw new Error(
        `Browser bundle contains ${unresolved.size} unresolved import(s), which rolldown compiled into modules that throw on load:\n` +
          `${[...unresolved].sort().join("\n")}\n` +
          `Install the dependency, or keep the module that pulls it in out of the browser graph.`,
      );
    },
  };
}

/**
 * The entries a page loads from a script tag. Everything else in
 * {@link ENTRY_BUDGETS_GZIP} is reached through `import()` from these.
 */
const INITIAL_ENTRIES = new Set(["client", "client-auth"]);

/**
 * Packages that may not be in an initial entry's static import graph.
 *
 * Each of these is large enough on its own to dominate a bundle, and none is
 * needed before the reader (or author) does something specific. A static
 * import anywhere in an initial entry's graph pulls the whole package into
 * the first page view — which is exactly how the public bundle once carried
 * the `pinyin-pro` dictionary behind a single URL helper. A prefix ending in
 * `/` or `-` matches every package under it.
 */
const LAZY_ONLY_PACKAGES = [
  // The editor: `client-compose.ts`.
  "@tiptap/",
  "prosemirror-",
  "marked",
  "linkifyjs",
  // Drag ordering in the composer, navigation manager, collection directory.
  "sortablejs",
  // Slug transliteration: `lib/slugify.ts`, loaded via `client/lazy-slugify.ts`.
  "limax",
  "pinyin-pro",
  "speakingurl",
  "hepburn",
  // The full Lucide index is for server rendering (`lib/icons.ts`); client
  // components inline the few icons they draw (`client/icons.ts`).
  "lucide-static",
  // Upload-time media processing (`client/mediabunny.ts`, `compose-bridge.ts`).
  "mediabunny",
  "heic-to",
  // Emoji picker, opened from the editor toolbar.
  "emoji-mart",
  "@emoji-mart/data",
];

/**
 * Gzipped byte budget for each browser entry, counting the entry chunk plus
 * every chunk it imports statically — what a first page view downloads before
 * any script runs. Every `build:client` run prints the current figures next
 * to these, so remeasuring is just building.
 *
 * Raise a budget only with a reason in the commit message; the numbers are
 * the point of this table.
 */
const ENTRY_BUDGETS_GZIP: Record<string, number> = {
  // Measured 2026-09: 37 KB. Datastar, Lit, and the reading interactions.
  client: 48 * 1024,
  // Measured 2026-09: 60 KB, public bundle included. Post menu, command
  // palette, shortcuts, composer triggers.
  "client-auth": 72 * 1024,
  // Measured 2026-09: 279 KB. TipTap and the editor (shared `create-editor`
  // chunk counted here and in the two entries below).
  "client-compose": 320 * 1024,
  // Measured 2026-09: 218 KB, mostly the shared editor chunk.
  "client-settings": 250 * 1024,
  // Measured 2026-09: 251 KB, mostly the shared editor chunk plus Sortable.
  "client-manage": 290 * 1024,
};

/**
 * Gzipped byte budget for the render-blocking stylesheets, keyed by the
 * source entry's asset name.
 *
 * `client.css` is the one a signed-out visitor waits on before anything
 * paints, so it is budgeted the same way the entry scripts are: author-only
 * component CSS belongs in `client-author.css` (see `styles/ui-author.css`),
 * and this stops it drifting back.
 */
const STYLE_BUDGETS_GZIP: Record<string, number> = {
  // Measured 2026-09: 48.7 KB. Was 73.8 KB before the author split, 54.1 KB
  // after `ui.css` was split and 48.7 KB after `components.css` followed.
  "style.css": 54 * 1024,
};

const NODE_MODULES_PACKAGE_RE =
  /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\//;

function lazyOnlyPackage(moduleId: string): string | null {
  const name = NODE_MODULES_PACKAGE_RE.exec(moduleId)?.[1];
  if (!name) return null;
  const hit = LAZY_ONLY_PACKAGES.some((pattern) =>
    /[/-]$/.test(pattern) ? name.startsWith(pattern) : name === pattern,
  );
  return hit ? name : null;
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Fails the client build when a bundle grows past what a page view should
 * pay for.
 *
 * Two checks, both over the static import closure of each entry (the entry
 * chunk plus the chunks it imports without `import()`):
 *
 * 1. For the {@link INITIAL_ENTRIES}, none of {@link LAZY_ONLY_PACKAGES} is
 *    in that closure. A chunk reached through `import()` may carry them —
 *    that is where they belong.
 * 2. The closure's gzipped size is within {@link ENTRY_BUDGETS_GZIP}.
 *
 * Runs in `generateBundle`, after code splitting, so it judges the chunks as
 * they will be served rather than the import graph as written.
 */
export function enforceClientBundleBudget(): Plugin {
  return {
    name: "jant:client-bundle-budget",
    generateBundle(_options, bundle) {
      type Chunk = Extract<(typeof bundle)[string], { type: "chunk" }>;
      const byFile = new Map<string, Chunk>();
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") byFile.set(output.fileName, output);
      }

      const problems = new Set<string>();
      const report: string[] = [];
      for (const entry of byFile.values()) {
        // CSS entries surface here as empty facade chunks that Vite drops
        // before writing; they are not scripts a page loads.
        if (!entry.isEntry || entry.facadeModuleId?.endsWith(".css")) continue;

        const closure: Chunk[] = [];
        const pending = [entry.fileName];
        const seen = new Set<string>();
        while (pending.length > 0) {
          const fileName = pending.pop()!;
          if (seen.has(fileName)) continue;
          seen.add(fileName);
          const chunk = byFile.get(fileName);
          if (!chunk) continue;
          closure.push(chunk);
          pending.push(...chunk.imports);
        }

        let gzipped = 0;
        for (const chunk of closure) {
          gzipped += gzipSync(chunk.code).length;
          if (!INITIAL_ENTRIES.has(entry.name)) continue;
          for (const moduleId of Object.keys(chunk.modules)) {
            const pkg = lazyOnlyPackage(moduleId);
            if (pkg) {
              problems.add(
                `  "${pkg}" is loaded statically by entry "${entry.name}" (in ${chunk.fileName}); it must only be reached through a dynamic import()`,
              );
            }
          }
        }

        const budget = ENTRY_BUDGETS_GZIP[entry.name];
        report.push(
          `  ${entry.name}: ${kb(gzipped)} gzipped${budget === undefined ? "" : ` (budget ${kb(budget)})`}`,
        );
        if (budget !== undefined && gzipped > budget) {
          problems.add(
            `  entry "${entry.name}" is ${kb(gzipped)} gzipped, over its ${kb(budget)} budget`,
          );
        }
      }

      for (const output of Object.values(bundle)) {
        if (output.type !== "asset") continue;
        // Keyed on the source entry's name (`style.css`), not the hashed
        // output name, so the lookup cannot drift with the hash format.
        const budget = STYLE_BUDGETS_GZIP[output.name ?? ""];
        if (budget === undefined) continue;
        const gzipped = gzipSync(output.source).length;
        report.push(
          `  ${output.name}: ${kb(gzipped)} gzipped (budget ${kb(budget)})`,
        );
        if (gzipped > budget) {
          problems.add(
            `  stylesheet "${output.name}" is ${kb(gzipped)} gzipped, over its ${kb(budget)} budget`,
          );
        }
      }

      console.log(`\nclient bundle budget\n${report.join("\n")}\n`);
      if (problems.size === 0) return;
      throw new Error(
        `Client bundle budget exceeded:\n${[...problems].sort().join("\n")}\n` +
          `For a script: load the package behind an import() at the point of use, or move the code that needs it out of the entry graph. For a stylesheet: move author-only rules to styles/ui-author.css. Budgets live in vite.shared.ts.`,
      );
    },
  };
}
