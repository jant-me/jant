/**
 * Inline SVG for the few Lucide icons client components render themselves.
 *
 * Server-rendered UI goes through `lib/icons.ts`, which indexes the whole
 * `lucide-static` set (1,700+ icons, ≈1 MB minified). Client code must not
 * import that module — one icon lookup would ship the entire set to the
 * browser — so the handful of icons a component needs at runtime live here as
 * literal markup, copied from `lucide-static` with the project's `icon-fine`
 * stroke class appended.
 */

/** Lucide `funnel`, the marker for a smart collection. */
export const FUNNEL_ICON_SVG =
  '<svg class="lucide lucide-funnel icon-fine" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/></svg>';
