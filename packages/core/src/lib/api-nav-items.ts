/**
 * Navigation item responses for the author API.
 *
 * Every field is listed here and in docs/API.md's Navigation Items table;
 * nothing reaches a response by being a column. Every field is always there,
 * and one that doesn't apply to the item's type is `null`, as on directory
 * items and custom URLs. The owning site is left out: a response always comes
 * from the site it was asked of.
 */

import type { NavItem } from "../types.js";

export interface ApiNavItemResponse {
  id: string;
  type: NavItem["type"];
  /** `system` items only. */
  systemKey: NonNullable<NavItem["systemKey"]> | null;
  /** `collection` items only. */
  collectionId: string | null;
  /** `smart_collection` items only. */
  smartCollectionId: string | null;
  /** `page` items only. */
  postId: string | null;
  /** The author's label, or `""` to follow the target. */
  label: string;
  url: string;
  /**
   * The target's current title, shown when `label` is empty. `null` for
   * `link` and `system` items, which have no target to follow.
   */
  targetTitle: string | null;
  placement: NavItem["placement"];
  position: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * One navigation item as the author API returns it.
 *
 * @param item - The navigation item, with its target's title resolved
 * @returns The navigation item response; target fields `null` outside the item's type
 * @example
 * return c.json({ navItems: items.map(toApiNavItem) });
 */
export function toApiNavItem(item: NavItem): ApiNavItemResponse {
  return {
    id: item.id,
    type: item.type,
    systemKey: item.systemKey ?? null,
    collectionId: item.collectionId ?? null,
    smartCollectionId: item.smartCollectionId ?? null,
    postId: item.postId ?? null,
    label: item.label,
    url: item.url,
    targetTitle: item.targetTitle ?? null,
    placement: item.placement,
    position: item.position,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
