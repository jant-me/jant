/**
 * Links into the published documentation
 *
 * Everything under `docs/` is published on the Jant site: `docs/multilingual.md`
 * is served at `/docs/multilingual`, lowercased and without the extension.
 *
 * The host is resolved once, here, so no call site writes a domain. Development
 * builds point at the control plane running locally, which serves the docs
 * being edited rather than the released ones.
 */

import { IS_VITE_DEV } from "./build-env.js";

/** Docs host for released builds. */
const DOCS_ORIGIN = "https://jant.me";

/** Docs host during development. */
const DEV_DOCS_ORIGIN = "https://jant-cloud.localtest.me";

/** Documentation index for the current environment. */
export const JANT_DOCS_BASE_URL = `${
  IS_VITE_DEV ? DEV_DOCS_ORIGIN : DOCS_ORIGIN
}/docs`;

/**
 * Build a link to one documentation page.
 *
 * @param page - Published page slug, optionally with a `#section` anchor. It is
 *   the file name under `docs/`, lowercased and without `.md`. Omit it to link
 *   the documentation index.
 * @returns Absolute URL to that page on the current environment's docs site
 * @example
 * ```ts
 * getJantDocsUrl("multilingual"); // "https://jant.me/docs/multilingual"
 * getJantDocsUrl("configuration#required");
 * // "https://jant.me/docs/configuration#required"
 * getJantDocsUrl(); // "https://jant.me/docs"
 * ```
 */
export function getJantDocsUrl(page = ""): string {
  return page ? `${JANT_DOCS_BASE_URL}/${page}` : JANT_DOCS_BASE_URL;
}
