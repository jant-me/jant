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
 */

import type { Plugin } from "vite";
import swc from "unplugin-swc";
import { resolve } from "path";
import { readFileSync } from "fs";
import { execSync } from "child_process";
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
 * - `client-auth.js` for authenticated/editor interactions
 * - `client.css` for the shared site styles
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
      style: resolve(dir, "src/style.css"),
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
      chunkFileNames: `${ASSET_BASE_SEGMENT}/${ASSET_CHUNK_SEGMENT}/[name]-[hash].js`,
      assetFileNames: (assetInfo) => {
        switch (assetInfo.name) {
          case "style.css":
            return `${ASSET_BASE_SEGMENT}/client-[hash].css`;
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
 * SWC plugin for Hono JSX transforms and Lingui macro rewrites.
 *
 * Every bundle needs it, browser bundles included: `lib/` modules are shared
 * between the worker and the client, and some of them declare their
 * reader-facing strings with the Lingui macro.
 */
export const swcPlugin = () =>
  swc.vite({
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
