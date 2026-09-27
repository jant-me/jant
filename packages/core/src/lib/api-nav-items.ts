/**
 * Navigation item responses for the author API.
 *
 * Every field is listed here and in docs/API.md's Navigation Items table;
 * nothing reaches a response by being a column. The owning site is left out:
 * a response always comes from the site it was asked of.
 */

import type { NavItem } from "../types.js";

export interface ApiNavItemResponse {
  id: string;
  type: NavItem["type"];
  /** `system` items only. */
  systemKey?: NavItem["systemKey"];
  /** `collection` items only. */
  collectionId?: string;
  /** `smart_collection` items only. */
  smartCollectionId?: string;
  /** `page` items only. */
  postId?: string;
  /** The author's label, or `""` to follow the target. */
  label: string;
  url: string;
  /**
   * The target's current title, shown when `label` is empty. Absent for
   * `link` and `system` items, which have no target to follow.
   */
  targetTitle?: string;
  placement: NavItem["placement"];
  position: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * One navigation item as the author API returns it.
 *
 * @param item - The navigation item, with its target's title resolved
 * @returns The navigation item response; target fields only for the item's type
 * @example
 * return c.json({ navItems: items.map(toApiNavItem) });
 */
export function toApiNavItem(item: NavItem): ApiNavItemResponse {
  return {
    id: item.id,
    type: item.type,
    ...(item.systemKey !== undefined ? { systemKey: item.systemKey } : {}),
    ...(item.collectionId !== undefined
      ? { collectionId: item.collectionId }
      : {}),
    ...(item.smartCollectionId !== undefined
      ? { smartCollectionId: item.smartCollectionId }
      : {}),
    ...(item.postId !== undefined ? { postId: item.postId } : {}),
    label: item.label,
    url: item.url,
    ...(item.targetTitle !== undefined
      ? { targetTitle: item.targetTitle }
      : {}),
    placement: item.placement,
    position: item.position,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
