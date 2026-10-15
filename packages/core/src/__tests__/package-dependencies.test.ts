/**
 * `dependencies` lists what a site has to install, and nothing else.
 *
 * The library build leaves a package in `dependencies` as an import a site
 * resolves from its own node_modules and bundles everything else into dist
 * (`vite.config.worker.ts`), and `bin/` runs unbundled from the installed
 * package. So a package belongs in `dependencies` exactly when the server or
 * the CLI loads it. Client-only packages used to sit there too, and every new
 * site downloaded TipTap, Lit, the emoji data and the HEIC and video encoders
 * that only the prebuilt browser bundles use. These walk the server and CLI
 * imports from source and fail when the two lists drift apart.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CORE_DIR = resolve(import.meta.dirname, "../..");

const DEPENDENCIES = Object.keys(
  (
    JSON.parse(readFileSync(join(CORE_DIR, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    }
  ).dependencies,
);

/** The library build's entries, as `build.lib.entry` names them. */
const SERVER_ENTRIES = ["src/index.ts", "src/node/index.ts"];

/** Specifiers a module loads at runtime; `import type` is erased. */
function runtimeSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [
    ...source.matchAll(
      /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm,
    ),
    ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1] ?? "");
}

function resolveModule(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ];
  return (
    candidates.find((candidate) =>
      statSync(candidate, { throwIfNoEntry: false })?.isFile(),
    ) ?? null
  );
}

/** The npm package a bare specifier names, or null for a builtin. */
function packageName(specifier: string): string | null {
  if (specifier.includes(":") || builtinModules.includes(specifier)) {
    return null;
  }
  const [scope, name] = specifier.split("/");
  return specifier.startsWith("@") ? `${scope}/${name}` : (scope ?? null);
}

/**
 * Packages a set of modules loads, following relative imports from them.
 * Imports into dist are left out: dist is the build of `SERVER_ENTRIES`.
 */
function loadedPackages(entries: string[]): Set<string> {
  const seen = new Set(entries);
  const queue = [...entries];
  const packages = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const specifier of runtimeSpecifiers(file)) {
      if (specifier.startsWith(".")) {
        const next = resolveModule(file, specifier);
        if (next && !next.includes("/dist/") && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
        continue;
      }
      const name = packageName(specifier);
      if (name && name !== "@jant/core") packages.add(name);
    }
  }
  return packages;
}

function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(path);
    return entry.name.endsWith(".js") ? [path] : [];
  });
}

describe("package dependencies", () => {
  const server = loadedPackages(
    SERVER_ENTRIES.map((entry) => join(CORE_DIR, entry)),
  );
  // Every file, not a walk: commands are loaded by name at run time.
  const cli = loadedPackages(jsFiles(join(CORE_DIR, "bin")));

  it("list only packages the server or the CLI loads", () => {
    expect(
      DEPENDENCIES.filter((name) => !server.has(name) && !cli.has(name)),
      "only the build or dist/client uses these: move them to devDependencies",
    ).toEqual([]);
  });

  it("list every package the CLI loads", () => {
    expect(
      [...cli].filter((name) => !DEPENDENCIES.includes(name)),
      "bin/ runs unbundled from a site's node_modules",
    ).toEqual([]);
  });
});
