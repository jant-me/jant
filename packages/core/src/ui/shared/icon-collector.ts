/**
 * Request-scoped icon collector for SSR SVG sprite pattern.
 *
 * The <Icon> component registers each used icon name here during render.
 * At the end of <body>, <IconSprite> reads the collected set and emits a
 * single <svg><symbol>...</symbol></svg> block so every <use href="#icon-x">
 * reference in the page resolves to a definition.
 *
 * Mirrors the I18nProvider pattern in i18n/context.tsx: Hono JSX renders
 * synchronously per request, so a module-level singleton is safe.
 */

import type { IconName } from "./custom-icons.js";

let currentCollector: Set<IconName> | null = null;

/**
 * Start a new collection scope for the current render pass.
 * Call at the top of the root layout before children render.
 */
export function resetIconCollector(): void {
  currentCollector = new Set<IconName>();
}

/**
 * Register an icon as used during this render.
 * Safe to call even when no collector is active (no-op).
 */
export function collectIcon(name: IconName): void {
  currentCollector?.add(name);
}

/**
 * Get the icon names collected so far during this render.
 * Returns an empty set if no collection scope is active.
 */
export function getCollectedIcons(): ReadonlySet<IconName> {
  return currentCollector ?? new Set<IconName>();
}
