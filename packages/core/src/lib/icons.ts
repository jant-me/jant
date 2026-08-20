/**
 * Shared icon utilities.
 *
 * Provides a small wrapper around lucide-static so server-rendered UI can fetch
 * SVG markup by kebab-case icon name.
 */

import * as lucideIcons from "lucide-static";

/**
 * Convert a kebab-case icon name to PascalCase for lucide-static lookup.
 *
 * @param name - Kebab-case icon name such as "book-open"
 * @returns PascalCase name such as "BookOpen"
 */
function toPascalCase(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Get SVG markup for a Lucide icon by kebab-case name.
 *
 * @param name - Kebab-case icon name
 * @param className - Extra classes for the `<svg>`, appended to Lucide's own.
 *   `icon-fine` is the project's lighter stroke.
 * @returns SVG string or null when the icon is unknown
 *
 * @example
 * ```ts
 * getIconSvg("book-open");
 * getIconSvg("funnel", "icon-fine");
 * ```
 */
export function getIconSvg(name: string, className?: string): string | null {
  const pascalName = toPascalCase(name);
  const svg = (lucideIcons as Record<string, string>)[pascalName];
  if (typeof svg !== "string") return null;
  if (!className) return svg;
  // Lucide always ships a `class="lucide lucide-…"`, so extend it rather than
  // adding a second class attribute the parser would drop.
  return svg.replace(/class="([^"]*)"/, `class="$1 ${className}"`);
}

/**
 * Get the inner SVG contents for a Lucide icon (the path children only,
 * without the outer <svg> wrapper). Used by the icon sprite to build
 * <symbol> definitions.
 *
 * @param name - Kebab-case icon name
 * @returns Inner SVG markup (e.g. "<path ... />"), or null when unknown
 *
 * @example
 * ```ts
 * getIconInnerSvg("book-open");
 * // -> "<path d=\"...\"/><path d=\"...\"/>"
 * ```
 */
export function getIconInnerSvg(name: string): string | null {
  const svg = getIconSvg(name);
  if (!svg) return null;
  // lucide-static output looks like:
  //   <svg ... viewBox="0 0 24 24" ...><path .../>...<line .../></svg>
  // Strip the outer <svg ...> and </svg>.
  const openTagEnd = svg.indexOf(">");
  const closeTagStart = svg.lastIndexOf("</svg>");
  if (openTagEnd < 0 || closeTagStart < 0) return null;
  return svg.slice(openTagEnd + 1, closeTagStart);
}

/**
 * Default stroke/fill attributes inherited by <symbol> children when a
 * lucide icon is referenced via <use>. These mirror the attributes lucide
 * normally sets on the outer <svg> so the currentColor-based theming keeps
 * working through <use>.
 */
export const LUCIDE_SYMBOL_ATTRS =
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const LUCIDE_VIEWBOX = "0 0 24 24";
