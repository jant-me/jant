/**
 * Which reader surfaces exist once per language.
 *
 * Mirrors the `langGet()` table in `routes/pages/language.tsx` — the two must
 * change together. Kept in its own module, free of server imports, because the
 * client needs the same answer: `viewPath()` uses it to decide whether a link
 * carries the current view's language prefix, and getting it wrong in either
 * direction is a bug you can see — a missing prefix drops the reader into
 * another language, an extra one lands on a 404.
 *
 * Everything not listed here — the dashboard, auth, collection editors, and
 * post permalinks — has one address site-wide.
 */

/** Surfaces served per language at exactly this path. */
const PER_LANGUAGE_SURFACES = new Set([
  "/",
  "/feed",
  "/latest",
  "/featured",
  "/archive",
  "/search",
  "/collections",
]);

/**
 * Surfaces whose sub-paths are all per-language too. `/collections/` is absent
 * on purpose: it also holds the editors, which are not.
 */
const PER_LANGUAGE_SURFACE_PREFIXES = ["/latest/", "/featured/", "/archive/"];

const COLLECTIONS_PREFIX = "/collections/";

/**
 * `/collections/{selection}` and its feed are per-language; `/collections/new`
 * and `/collections/{slug}/edit` are the collection editors, which exist once.
 */
function isCollectionSelectionSurface(path: string): boolean {
  const rest = path.slice(COLLECTIONS_PREFIX.length);
  if (!rest) return false;

  const segments = rest.split("/");
  if (segments[0] === "" || segments[0] === "new") return false;
  if (segments.length === 1) return true;
  return segments.length === 2 && segments[1] === "feed";
}

/**
 * Whether a path exists in every language's view.
 *
 * @param path - Internal app path, without any language prefix. A query string
 *   or fragment is ignored, so callers can pass a built link as-is.
 * @returns True when `/ja{path}` is a page rather than a 404
 * @example
 * isPerLanguageSurface("/archive?media=any"); // true — /ja/archive exists
 * isPerLanguageSurface("/collections/recipes/edit"); // false — one editor
 * isPerLanguageSurface("/settings/language"); // false — the dash is one place
 */
export function isPerLanguageSurface(path: string): boolean {
  const bare = path.split(/[?#]/, 1)[0] ?? path;
  if (PER_LANGUAGE_SURFACES.has(bare)) return true;
  if (bare.startsWith(COLLECTIONS_PREFIX)) {
    return isCollectionSelectionSurface(bare);
  }
  return PER_LANGUAGE_SURFACE_PREFIXES.some((prefix) =>
    bare.startsWith(prefix),
  );
}
