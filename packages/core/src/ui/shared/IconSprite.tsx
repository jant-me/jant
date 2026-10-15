/**
 * <IconSprite> — emits the SVG symbol definitions used by this render.
 *
 * Must be rendered AFTER all <Icon> usages in the document (e.g. at the
 * end of <body>) so the collector has the full set of icon names. Hono
 * JSX stringifies synchronously in document order, so children declared
 * earlier in the tree are evaluated before this component.
 *
 * <use href="#icon-x"> anywhere in the document resolves correctly even
 * when the <symbol> definition comes after the reference, since browsers
 * wire up the references after the full document is parsed.
 */

import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import {
  getIconInnerSvg,
  LUCIDE_SYMBOL_ATTRS,
  LUCIDE_VIEWBOX,
} from "../../lib/icons.js";
import { getCollectedIcons } from "./icon-collector.js";
import {
  getCustomSymbol,
  isCustomIconName,
  type IconName,
} from "./custom-icons.js";

function buildSymbol(name: IconName): string {
  if (isCustomIconName(name)) {
    const custom = getCustomSymbol(name);
    return `<symbol id="icon-${name}" viewBox="${custom.viewBox}">${custom.inner}</symbol>`;
  }
  return `<symbol id="icon-${name}" viewBox="${LUCIDE_VIEWBOX}" ${LUCIDE_SYMBOL_ATTRS}>${getIconInnerSvg(name)}</symbol>`;
}

export const IconSprite: FC = () => {
  const names = Array.from(getCollectedIcons()).sort();
  const symbols = names.map(buildSymbol).join("");

  if (!symbols) return null;

  // Hidden from layout and AT; provides the <symbol> definitions only.
  // Use raw() as a child instead of dangerouslySetInnerHTML because Hono
  // wraps <svg> with an internal nameSpaceContext child, which makes
  // dangerouslySetInnerHTML conflict with children and throw.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      style="display:none"
      aria-hidden="true"
      data-icon-sprite
    >
      {raw(symbols)}
    </svg>
  );
};
