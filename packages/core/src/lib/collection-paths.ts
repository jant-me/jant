/**
 * Collection URL helpers.
 *
 * Single collections use root-level paths. The collections directory and
 * aggregate views live under `/collections`. There is no editor path: a
 * collection is created and edited in a dialog.
 */

export const COLLECTIONS_DIRECTORY_PATH = "/collections";

export function isAggregateCollectionSelection(
  slugExpression: string,
): boolean {
  return slugExpression.includes("+");
}

export function getCollectionsDirectoryPath(): string {
  return COLLECTIONS_DIRECTORY_PATH;
}

export function getCollectionPagePath(slug: string): string {
  return `/${slug}`;
}

export function getCollectionSelectionPath(slugExpression: string): string {
  return isAggregateCollectionSelection(slugExpression)
    ? `${COLLECTIONS_DIRECTORY_PATH}/${slugExpression}`
    : getCollectionPagePath(slugExpression);
}

export function getCollectionSelectionFeedPath(slugExpression: string): string {
  return `${getCollectionSelectionPath(slugExpression)}/feed`;
}
