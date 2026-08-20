/**
 * Helpers for deriving aggregate collection groups from divider sections.
 */

export interface GroupableCollectionItem {
  type: "collection" | "smart_collection" | "divider" | "link";
  label?: string | null;
  url?: string | null;
  collection?: {
    slug: string;
  };
}

export interface DividerCollectionGroup {
  slugExpression: string;
  collectionCount: number;
}

/**
 * Returns the aggregate collection selection that belongs to a divider.
 *
 * A divider maps to the consecutive collection items that follow it until the
 * next divider. Groups with fewer than two collections do not produce an
 * aggregate selection.
 *
 * A smart collection sitting in the group contributes nothing and does not
 * break it: `/collections/{a+b}` is a union of tagged sets, and a set defined
 * by conditions has no slug to union in. It is skipped the same way a link is.
 *
 * @param items - Ordered collection directory items
 * @param dividerIndex - Index of the divider item to inspect
 * @returns Aggregate slug expression and count, or `null`
 *
 * @example
 * ```ts
 * getDividerCollectionGroup(
 *   [
 *     { type: "divider", label: "Reading" },
 *     { type: "collection", collection: { slug: "books" } },
 *     { type: "collection", collection: { slug: "essays" } },
 *   ],
 *   0,
 * );
 * ```
 */
export function getDividerCollectionGroup(
  items: readonly GroupableCollectionItem[],
  dividerIndex: number,
): DividerCollectionGroup | null {
  const divider = items[dividerIndex];
  if (!divider || divider.type !== "divider" || !divider.label) {
    return null;
  }

  const slugs: string[] = [];

  for (let index = dividerIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (!item) break;
    if (item.type === "divider") break;
    const slug = item.collection?.slug;
    if (!slug) continue;
    slugs.push(slug);
  }

  if (slugs.length < 2) {
    return null;
  }

  return {
    slugExpression: slugs.join("+"),
    collectionCount: slugs.length,
  };
}
