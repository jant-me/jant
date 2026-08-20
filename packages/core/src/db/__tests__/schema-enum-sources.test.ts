import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The schema files must not keep private copies of the value lists that
 * `types/constants.ts` already owns.
 *
 * This is not a style rule. A CHECK constraint is generated from whatever list
 * the schema file can see, so a private copy that stops matching the shared one
 * produces a constraint that rejects rows the application considers valid — and
 * the schema files are the one place where nothing else would catch it, because
 * `drizzle-kit generate` happily emits the wrong constraint and the types still
 * line up on both sides.
 */
const SCHEMA_FILES = ["../schema.ts", "../pg/schema.ts"];

/** `const NAME = [...] as const`, the shape a value list is declared in. */
const LOCAL_VALUE_LIST =
  /const\s+([A-Z][A-Z0-9_]*)\s*=\s*\[[^\]]*\]\s*as const/g;

describe("schema value lists", () => {
  for (const file of SCHEMA_FILES) {
    it(`${file} declares no value list of its own`, () => {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      const declared = [...source.matchAll(LOCAL_VALUE_LIST)].map(
        (match) => match[1],
      );

      expect(declared).toEqual([]);
    });
  }
});
