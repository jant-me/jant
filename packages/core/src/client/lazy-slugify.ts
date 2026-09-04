/**
 * Lazy-loaded slug generation
 *
 * Wraps the `slugify` function from `lib/slugify.ts` behind a dynamic import so
 * `limax` (used for i18n-aware transliteration) doesn't bloat the main
 * client bundle. Vite code-splits it into a separate chunk.
 *
 * @example
 * ```ts
 * import { slugify, preloadSlug } from "./lazy-slugify.js";
 *
 * preloadSlug(); // start loading in background
 * const s = await slugify("你好世界"); // "ni-hao-shi-jie"
 * ```
 */

type SlugifyFn = (text: string) => string;

let slugifyFn: SlugifyFn | undefined;
let loadingPromise: Promise<SlugifyFn> | undefined;

function load(): Promise<SlugifyFn> {
  if (slugifyFn) return Promise.resolve(slugifyFn);
  if (!loadingPromise) {
    loadingPromise = import("../lib/slugify.js").then((mod) => {
      slugifyFn = mod.slugify;
      return mod.slugify;
    });
  }
  return loadingPromise;
}

/**
 * Start loading the slug library in the background.
 * Call this early (e.g. when a form mounts) so `slugify()` resolves instantly later.
 */
export function preloadSlug(): void {
  load();
}

/**
 * Generate a URL-safe slug from the given text.
 * Handles CJK scripts via pinyin transliteration.
 *
 * @param text - The input string to slugify
 * @returns A lowercased, hyphen-separated slug
 */
export async function slugify(text: string): Promise<string> {
  const fn = await load();
  return fn(text);
}
