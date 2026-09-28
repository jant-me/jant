/**
 * No Vite config loads a module that needs the SWC transform.
 *
 * Vite bundles a config file with plain esbuild before any plugin exists, so
 * whatever a config imports statically runs without the SWC Lingui transform
 * or the `define` globals. `vite.config.node.ts` imported the Node request
 * handler that way; once the handler's settings validation reached
 * `lib/filter-dimensions.ts`, whose top level calls `msg`, `mise run dev-node`
 * stopped starting, and nothing failed. A config reaches `src/` through Vite's
 * module runner instead. This walks each config's static imports and fails on
 * any file that imports the macro.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CORE_DIR = resolve(import.meta.dirname, "../..");
const MACRO = "@lingui/core/macro";

/** Relative modules a file imports at runtime; `import type` is erased. */
function runtimeImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [
    ...source.matchAll(
      /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\s+from\s+)?["'](\.[^"']+)["']/gm,
    ),
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

/** Files a config loads, and the first one found importing the macro. */
function walk(entry: string): {
  files: Set<string>;
  macroChain: string[] | null;
} {
  const files = new Set([entry]);
  const parent = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (
      /from\s+["']@lingui\/core\/macro["']/.test(readFileSync(file, "utf8"))
    ) {
      const chain = [file];
      for (let at = parent.get(file); at; at = parent.get(at))
        chain.unshift(at);
      return { files, macroChain: chain };
    }
    for (const specifier of runtimeImports(file)) {
      const next = resolveModule(file, specifier);
      if (next && !files.has(next)) {
        files.add(next);
        parent.set(next, file);
        queue.push(next);
      }
    }
  }
  return { files, macroChain: null };
}

const CONFIGS = readdirSync(CORE_DIR).filter((name) =>
  /^vite\.config(\.[a-z]+)?\.ts$/.test(name),
);

describe("Vite config graphs", () => {
  it("find every config", () => {
    expect(CONFIGS).toEqual(
      expect.arrayContaining(["vite.config.ts", "vite.config.node.ts"]),
    );
  });

  it.each(CONFIGS)(`%s never reaches ${MACRO}`, (config) => {
    const { files, macroChain } = walk(join(CORE_DIR, config));
    // The walk has to see through the configs' own helpers to mean anything.
    expect(files.size).toBeGreaterThan(1);
    expect(
      macroChain?.map((file) => file.replace(`${CORE_DIR}/`, "")) ?? null,
      `imports ${MACRO}`,
    ).toBeNull();
  });
});
