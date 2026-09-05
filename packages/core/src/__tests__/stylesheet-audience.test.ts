import { describe, expect, it } from "vitest";
import {
  readAuthorCss,
  readComponentCss,
  readReaderCss,
} from "./helpers/component-css.js";

/**
 * `client.css` is what a signed-out visitor waits on before the page paints,
 * and `styles/ui.css` plus `styles/components.css` are the hand-written half
 * of it. Author-only component CSS belongs in `styles/ui-author.css` and
 * `styles/components-author.css`, which `BaseLayout` links only on
 * authenticated pages.
 *
 * Class families that only ever appear in authenticated markup. The editor's
 * `.tiptap-*` chrome is here too, minus the names TipTap also writes into
 * published post HTML — readers see those.
 */
const AUTHOR_ONLY = [
  "compose",
  "command",
  "settings",
  "picker",
  "confirm",
  "draft",
  "theme-preview",
  // From `components.css`: the config editor, the navigation manager, the
  // custom URL manager, the dash chrome and the form skeletons. `.nav-*` here
  // is `jant-nav-manager`, not the site header — that is `.site-header-nav`.
  // `.collection-picker-*` is spelled out because plain `.collection-*` is a
  // reader family (the collection pages).
  "config",
  "nav",
  "custom",
  "dash",
  "skel",
  "collection-picker",
];

/** TipTap class names that land in reader-rendered post HTML. */
const READER_TIPTAP = [
  "tiptap-table",
  "tiptap-html-block",
  "tiptap-more-break",
  "tiptap-embed-figure",
  "tiptap-embed-frame",
  "tiptap-embed-fallback",
  "tiptap-footnote-reference",
  "tiptap-footnote-definition",
];

/**
 * `.compose-thread-layout` shares the compose rail's marker vocabulary with
 * the reading rail's `.thread-group` in one declaration, so that the two
 * cannot drift apart. That single grouped selector is the documented
 * exception; see the comment on the rule in `styles/ui.css`.
 */
const READER_SHEET_EXCEPTIONS = [".compose-thread-layout"];

/** Every class named in a selector, ignoring declaration bodies. */
function selectorClasses(css: string): string[] {
  const found: string[] = [];
  // Selectors are what precedes a `{` that opens a block; declarations end in
  // `;`, so anything after the last `;` or `}` is the selector text.
  for (const chunk of css.split("{")) {
    const selector = chunk.slice(
      Math.max(chunk.lastIndexOf(";"), chunk.lastIndexOf("}")) + 1,
    );
    const withoutComments = selector.replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const match of withoutComments.matchAll(
      /\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g,
    )) {
      found.push(match[1]!);
    }
  }
  return found;
}

describe("stylesheet audience", () => {
  it("keeps author-only component CSS out of the reader stylesheet", () => {
    const css = readReaderCss();
    const exceptions = new Set(
      READER_SHEET_EXCEPTIONS.map((name) => name.replace(/^\./, "")),
    );

    const leaked = [
      ...new Set(
        selectorClasses(css).filter(
          (name) =>
            !exceptions.has(name) &&
            AUTHOR_ONLY.some(
              (family) => name === family || name.startsWith(`${family}-`),
            ),
        ),
      ),
    ].sort();

    expect(leaked).toEqual([]);
  });

  it("keeps the editor chrome out of the reader stylesheet", () => {
    const readerTiptap = new Set(READER_TIPTAP);
    const leaked = [
      ...new Set(
        selectorClasses(readReaderCss()).filter(
          (name) =>
            (name === "tiptap" || name.startsWith("tiptap-")) &&
            !readerTiptap.has(name),
        ),
      ),
    ].sort();

    expect(leaked).toEqual([]);
  });

  it("still styles the TipTap output a published post carries", () => {
    // `lib/embed-render.ts` and `lib/markdown-manager.ts` write these into post
    // HTML, and they are the ones with rules of their own — a reader holding
    // only `client.css` has to be able to style them. The rest of
    // READER_TIPTAP reaches published posts too but is styled by element
    // through `.prose`, so there is no rule here to keep.
    const css = readReaderCss();
    for (const name of [
      "tiptap-embed-figure",
      "tiptap-embed-frame",
      "tiptap-embed-fallback",
      "tiptap-more-break",
    ]) {
      expect(selectorClasses(css)).toContain(name);
    }
  });

  it("moved real weight, not a handful of rules", () => {
    // The split is only worth its complexity while the author half is
    // substantial. If it ever shrinks to a rounding error, fold it back in.
    expect(readAuthorCss().length).toBeGreaterThan(readReaderCss().length / 2);
  });

  it("keeps the author half of components.css out of the reader sheet", () => {
    // `preset.css` imports `components.css` on every page, so the settings
    // pages and the config editor must not be left in it.
    const author = readAuthorCss();
    expect(author).toContain(".settings-root");
    expect(author).toContain(".config-editor-page");
  });

  it("leaves the reader-side families of components.css in place", () => {
    // Verified against every `class=` usage in the tree: `BaseLayout` renders
    // the toast container on every page, and `.page-intro-*` is the header of
    // the archive and collections pages, both public.
    const reader = readReaderCss();
    expect(reader).toContain(".toast-container");
    expect(reader).toContain(".page-intro");
  });
});
