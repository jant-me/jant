import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `src/styles`, resolved from the working directory rather than
 * `import.meta.url`: under the `happy-dom` environment `import.meta.url` is an
 * `http:` URL that `readFileSync` rejects, and Vitest runs with the package
 * root as its working directory in every environment.
 */
const STYLES_DIR = resolve(process.cwd(), "src/styles");

/** Hand-written component CSS a signed-out visitor downloads. */
const READER_SHEETS = ["ui.css", "components.css"] as const;

/** Hand-written component CSS that only loads on an authenticated page. */
const AUTHOR_SHEETS = ["ui-author.css", "components-author.css"] as const;

function read(names: readonly string[]): string {
  return names
    .map((name) => readFileSync(resolve(STYLES_DIR, name), "utf8"))
    .join("\n");
}

/**
 * Every `@layer components` rule Jant hand-writes, both audiences together.
 *
 * `ui.css`/`components.css` carry what readers need; `ui-author.css` and
 * `components-author.css` carry the composer, editor, settings, config editor
 * and dash chrome that only load once someone is signed in. A test asserting
 * that a rule is declared cares that it exists at all, not which half it
 * landed in — so moving a rule between them must never break a test.
 *
 * @returns The concatenated contents of all four stylesheets.
 * @example
 * expect(readComponentCss()).toMatch(/\.compose-post-meta-panel\s*\{/);
 */
export function readComponentCss(): string {
  return read([...READER_SHEETS, ...AUTHOR_SHEETS]);
}

/**
 * Only the reader halves.
 *
 * Use when the point of the assertion is that a rule ships to signed-out
 * visitors — or, with a negative matcher, that it does not.
 *
 * @returns The concatenated contents of `ui.css` and `components.css`.
 * @example
 * expect(readReaderCss()).not.toMatch(/\.compose-dialog\s*\{/);
 */
export function readReaderCss(): string {
  return read(READER_SHEETS);
}

/**
 * Only the author halves.
 *
 * @returns The concatenated contents of `ui-author.css` and
 * `components-author.css`.
 * @example
 * expect(readAuthorCss()).toMatch(/\.settings-root\s*\{/);
 */
export function readAuthorCss(): string {
  return read(AUTHOR_SHEETS);
}
