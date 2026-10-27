/**
 * <Icon> — sprite-based SVG icon for SSR pages.
 *
 * Renders a lightweight <svg><use href="#icon-${name}"/></svg> stub and
 * registers the icon name with the request-scoped collector so the final
 * sprite (rendered by <IconSprite>) contains exactly the icons used on
 * this page.
 *
 * Name refers to a Lucide icon listed in `lib/icons.ts` or one of the
 * custom symbols defined in `custom-icons.ts`; any other name fails the
 * type check.
 *
 * Inside `renderIconsInline()` it draws the icon's own paths instead, for
 * markup that is copied out of the page (the share card).
 *
 * Size: outer <svg> width/height in pixels. Defaults to 24 (lucide default).
 * Pass `class` to add CSS classes, e.g. for sizing via stylesheet instead
 * of inline width/height.
 */

import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { getIconInnerSvg, LUCIDE_SYMBOL_ATTRS } from "../../lib/icons.js";
import { collectIcon, iconsRenderInline } from "./icon-collector.js";
import {
  getCustomSymbol,
  getIconViewBox,
  isCustomIconName,
  type IconName,
} from "./custom-icons.js";

/** The icon's own drawing, as its sprite symbol would carry it. */
function inlineIconMarkup(name: IconName): string {
  if (isCustomIconName(name)) return getCustomSymbol(name).inner;
  return `<g ${LUCIDE_SYMBOL_ATTRS}>${getIconInnerSvg(name)}</g>`;
}

export interface IconProps {
  /** Kebab-case icon name (lucide or custom). */
  name: IconName;
  /** Width/height in px. Omit to size via CSS. */
  size?: number;
  /** CSS class for the outer <svg>. */
  class?: string;
  /** Accessible label. If set, the icon is not aria-hidden. */
  "aria-label"?: string;
  /**
   * Whether this icon is decorative. Defaults to true (aria-hidden) when
   * no aria-label is provided.
   */
  "aria-hidden"?: boolean | "true" | "false";
}

export const Icon: FC<IconProps> = ({
  name,
  size,
  class: cls,
  "aria-label": ariaLabel,
  "aria-hidden": ariaHidden,
}) => {
  collectIcon(name);

  const hidden = ariaHidden ?? (ariaLabel ? undefined : true);

  return (
    <svg
      viewBox={getIconViewBox(name)}
      {...(size !== undefined ? { width: size, height: size } : {})}
      {...(cls ? { class: cls } : {})}
      {...(ariaLabel ? { "aria-label": ariaLabel, role: "img" } : {})}
      {...(hidden ? { "aria-hidden": "true" } : {})}
    >
      {iconsRenderInline() ? (
        raw(inlineIconMarkup(name))
      ) : (
        <use href={`#icon-${name}`} />
      )}
    </svg>
  );
};
