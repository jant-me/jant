/**
 * Custom (non-lucide) SVG symbol definitions used by the icon sprite.
 *
 * Icons here fall into three groups:
 *   1. Jant-specific paths (decorative quote mark, featured sparkle).
 *   2. Lucide-equivalent paths the UI uses with non-default stroke widths
 *      or sizes that don't match the stock lucide symbol (we keep them as
 *      custom symbols to preserve exact visual fidelity during refactor).
 *   3. Fixed-color SVGs (video play overlay) that don't use currentColor.
 *
 * Each entry provides everything needed to render a <symbol> element:
 *   <symbol id="icon-${name}" viewBox={viewBox}>{inner}</symbol>
 * Consumers of <Icon name="..."> pass `size` / `className` on the outer
 * <svg><use/></svg>; `<symbol>` children inherit the outer attributes.
 */

import {
  FEATURED_SPARKLE_PATH,
  FEATURED_SPARKLE_OFF_SLASH_PATH,
} from "../../lib/featured-icons.js";
import {
  DECORATIVE_QUOTE_MARK_PATHS,
  DECORATIVE_QUOTE_MARK_VIEWBOX,
} from "../../lib/decorative-quote-mark.js";

export interface CustomSymbol {
  viewBox: string;
  /** Inner SVG markup (paths, circles, etc). Must be trusted HTML. */
  inner: string;
}

const STROKE_THIN =
  'fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"';
const STROKE_POST_BADGE =
  'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

export const CUSTOM_SYMBOLS: Record<string, CustomSymbol> = {
  // Featured sparkle (thinner stroke than lucide's stock "sparkles").
  "featured-sparkle": {
    viewBox: "0 0 24 24",
    inner: `<path ${STROKE_THIN} d="${FEATURED_SPARKLE_PATH}" />`,
  },
  // Featured sparkle with a diagonal slash (for "unfeature" affordances).
  "featured-sparkle-off": {
    viewBox: "0 0 24 24",
    inner: `<path ${STROKE_THIN} d="${FEATURED_SPARKLE_PATH}" /><path ${STROKE_THIN} d="${FEATURED_SPARKLE_OFF_SLASH_PATH}" />`,
  },
  // Decorative double-quote glyph (96×96, filled).
  "decorative-quote": {
    viewBox: DECORATIVE_QUOTE_MARK_VIEWBOX,
    inner: DECORATIVE_QUOTE_MARK_PATHS.map(
      (path) => `<path fill="currentColor" d="${path}" />`,
    ).join(""),
  },
  // Post collection lock (thin 1.35 stroke, 16×16 viewBox).
  "post-collection-lock": {
    viewBox: "0 0 16 16",
    inner: `<rect ${STROKE_THIN} x="3" y="5.05" width="10" height="8.15" rx="2.2" /><path ${STROKE_THIN} d="M5.1 5.05V4.2a1.1 1.1 0 0 1 1.1-1.1h3.6a1.1 1.1 0 0 1 1.1 1.1v.85" />`,
  },
  // Post menu trigger: three dots, filled.
  "post-menu-dots": {
    viewBox: "0 0 24 24",
    inner: `<circle cx="5" cy="12" r="1.75" fill="currentColor" /><circle cx="12" cy="12" r="1.75" fill="currentColor" /><circle cx="19" cy="12" r="1.75" fill="currentColor" />`,
  },
  // External arrow in a box (used in post footer external link affordance).
  "post-external-link": {
    viewBox: "0 0 24 24",
    inner: `<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 17 17 7" /><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 7h8v8" />`,
  },
  // Reply arrow (used on "Reply" button).
  "post-reply": {
    viewBox: "0 0 24 24",
    inner: `<polyline fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="9 17 4 12 9 7" /><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M20 18v-2a4 4 0 0 0-4-4H4" />`,
  },
  // Link card domain favicon fallback (external link arrow to new page).
  "link-domain": {
    viewBox: "0 0 24 24",
    inner: `<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />`,
  },
  // Video preview play button overlay (YouTube-style, fixed colors).
  "link-preview-play": {
    viewBox: "0 0 68 48",
    inner:
      '<path class="link-preview-play-bg" fill="rgba(0,0,0,.65)" d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" /><path fill="#fff" d="M45 24L27 14v20" />',
  },
  // Small play triangle (for provider badge).
  "link-preview-badge-play": {
    viewBox: "0 0 16 16",
    inner: '<path fill="currentColor" d="M5.5 3.5v9l7-4.5z" />',
  },
  // Toast icons (no lucide equivalent at these exact sizes).
  "toast-success": {
    viewBox: "0 0 24 24",
    inner: `<circle fill="none" stroke="currentColor" stroke-width="2" cx="12" cy="12" r="10" /><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 12 2 2 4-4" />`,
  },
  "toast-error": {
    viewBox: "0 0 24 24",
    inner: `<circle fill="none" stroke="currentColor" stroke-width="2" cx="12" cy="12" r="10" /><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m15 9-6 6M9 9l6 6" />`,
  },
  "toast-close": {
    viewBox: "0 0 24 24",
    inner: `<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12" />`,
  },
  // Post status badge: pinned (custom pin, thin 1.75 stroke).
  "post-status-pin": {
    viewBox: "0 0 24 24",
    inner: `<line ${STROKE_POST_BADGE} x1="12" x2="12" y1="17" y2="22" /><path ${STROKE_POST_BADGE} d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />`,
  },
  // Post status badge: draft (lucide pencil-line, thin 1.75 stroke).
  "post-status-draft": {
    viewBox: "0 0 24 24",
    inner: `<path ${STROKE_POST_BADGE} d="M12 20h9" /><path ${STROKE_POST_BADGE} d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />`,
  },
  // Post status badge: private (lucide eye-off, thin 1.75 stroke).
  "post-status-private": {
    viewBox: "0 0 24 24",
    inner: `<path ${STROKE_POST_BADGE} d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path ${STROKE_POST_BADGE} d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path ${STROKE_POST_BADGE} d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path ${STROKE_POST_BADGE} d="m2 2 20 20" />`,
  },
};

export function getCustomSymbol(name: string): CustomSymbol | null {
  return CUSTOM_SYMBOLS[name] ?? null;
}

/**
 * Return the viewBox for an icon's outer <svg> wrapper.
 *
 * This must match the <symbol>'s viewBox so the browser computes the correct
 * intrinsic aspect ratio. Without this, outer <svg> with `height: auto` in
 * CSS falls back to the 300×150 replaced-element default instead of the
 * icon's real aspect ratio.
 *
 * Falls back to lucide's "0 0 24 24" for lucide-sourced icons.
 */
export function getIconViewBox(name: string): string {
  return CUSTOM_SYMBOLS[name]?.viewBox ?? "0 0 24 24";
}
