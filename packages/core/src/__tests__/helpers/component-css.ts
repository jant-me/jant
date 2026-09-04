import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `src/styles`, resolved from the working directory rather than
 * `import.meta.url`: under the `happy-dom` environment `import.meta.url` is an
 * `http:` URL that `readFileSync` rejects, and Vitest runs with the package
 * root as its working directory in every environment.
 */
const STYLES_DIR = resolve(process.cwd(), "src/styles");

/**
 * The hand-written component CSS, both halves concatenated.
 *
 * `styles/ui.css` carries what readers need and `styles/ui-author.css` the
 * composer, editor, settings and draft chrome that only loads once someone is
 * signed in. A test asserting that a rule is declared cares that it exists in
 * the component CSS, not which half it landed in — so moving a rule between
 * them must never break a test.
 *
 * @returns Every `@layer components` rule Jant hand-writes, as one string.
 * @example
 * expect(readComponentCss()).toMatch(/\.compose-post-meta-panel\s*\{/);
 */
export function readComponentCss(): string {
  return [
    readFileSync(resolve(STYLES_DIR, "ui.css"), "utf8"),
    readFileSync(resolve(STYLES_DIR, "ui-author.css"), "utf8"),
  ].join("\n");
}

/**
 * Only the reader half of the component CSS.
 *
 * Use when the point of the assertion is that a rule ships to signed-out
 * visitors — or, with a negative matcher, that it does not.
 *
 * @returns The contents of `styles/ui.css`.
 * @example
 * expect(readReaderCss()).not.toMatch(/\.compose-/);
 */
export function readReaderCss(): string {
  return readFileSync(resolve(STYLES_DIR, "ui.css"), "utf8");
}
