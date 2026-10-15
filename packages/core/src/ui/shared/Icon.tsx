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
 * Size: outer <svg> width/height in pixels. Defaults to 24 (lucide default).
 * Pass `class` to add CSS classes, e.g. for sizing via stylesheet instead
 * of inline width/height.
 */

import type { FC } from "hono/jsx";
import { collectIcon } from "./icon-collector.js";
import { getIconViewBox, type IconName } from "./custom-icons.js";

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
      <use href={`#icon-${name}`} />
    </svg>
  );
};
