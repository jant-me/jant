/**
 * The package publishes its types from `src/index.ts` alone.
 *
 * It used to publish `src/index.ts` itself as its types, and `App` was the
 * whole Hono instance: a site's type check compiled Jant's source and needed
 * `hono` installed as a peer to resolve it. The library build now writes
 * `dist/index.d.ts` from that one file, which only works while the file
 * names no type from another module. These fail when it starts to.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createApp as createHonoApp } from "../app.js";
import type { App } from "../index.js";

const CORE_DIR = resolve(import.meta.dirname, "../..");

describe("published types", () => {
  const fileName = resolve(CORE_DIR, "src/index.ts");
  const { outputText, diagnostics } = ts.transpileDeclaration(
    readFileSync(fileName, "utf8"),
    { fileName, compilerOptions: { declaration: true } },
  );

  it("declare src/index.ts without reaching into another module", () => {
    expect(diagnostics ?? []).toEqual([]);
    const declared = ts.createSourceFile(
      "index.d.ts",
      outputText,
      ts.ScriptTarget.Latest,
    );
    const references = declared.statements.filter(
      (statement) =>
        ts.isImportDeclaration(statement) ||
        ts.isImportEqualsDeclaration(statement) ||
        (ts.isExportDeclaration(statement) && statement.moduleSpecifier),
    );
    expect(references.map((statement) => statement.getText(declared))).toEqual(
      [],
    );
    expect(outputText).toContain("export declare function createApp(): App;");
    expect(outputText).toMatch(/export interface App \{[\s\S]*fetch\(/);
  });

  it("are what package.json points at, with nothing to install beside them", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(CORE_DIR, "package.json"), "utf8"),
    ) as {
      exports: Record<string, { types?: string } | string>;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.exports["."]).toMatchObject({ types: "./dist/index.d.ts" });
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  it("describe what createApp returns", () => {
    // A compile-time check as much as a runtime one: the Hono instance has to
    // satisfy the published interface.
    const app: App = createHonoApp();
    expect(typeof app.fetch).toBe("function");
  });
});
