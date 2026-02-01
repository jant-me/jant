/**
 * Pagination Component
 *
 * Cursor-based pagination for post lists
 */

import type { FC } from "hono/jsx";
import type { Context } from "hono";
import { msg } from "@lingui/core/macro";
import { getI18n } from "../../i18n/index.js";

export interface PaginationProps {
  c: Context;
  /** Base URL for pagination links (e.g., "/archive", "/search?q=test") */
  baseUrl: string;
  /** Whether there are more items after the current page */
  hasMore: boolean;
  /** Cursor for the next page (typically the last item's ID) */
  nextCursor?: number | string;
  /** Cursor for the previous page */
  prevCursor?: number | string;
  /** Parameter name for cursor (default: "cursor") */
  cursorParam?: string;
}

export const Pagination: FC<PaginationProps> = ({
  c,
  baseUrl,
  hasMore,
  nextCursor,
  prevCursor,
  cursorParam = "cursor",
}) => {
  const i18n = getI18n(c);
  const hasPrev = prevCursor !== undefined;
  const hasNext = hasMore && nextCursor !== undefined;

  if (!hasPrev && !hasNext) {
    return null;
  }

  // Build URL with cursor parameter
  const buildUrl = (cursor: number | string) => {
    const url = new URL(baseUrl, "http://localhost");
    url.searchParams.set(cursorParam, String(cursor));
    return `${url.pathname}${url.search}`;
  };

  const prevText = i18n._(msg({ message: "Previous", comment: "@context: Pagination button - previous page" }));
  const nextText = i18n._(msg({ message: "Next", comment: "@context: Pagination button - next page" }));

  return (
    <nav class="flex items-center justify-between py-4" aria-label="Pagination">
      <div>
        {hasPrev ? (
          <a
            href={buildUrl(prevCursor)}
            class="btn-outline text-sm"
          >
            ← {prevText}
          </a>
        ) : (
          <span class="btn-outline text-sm opacity-50 cursor-not-allowed">
            ← {prevText}
          </span>
        )}
      </div>

      <div>
        {hasNext ? (
          <a
            href={buildUrl(nextCursor)}
            class="btn-outline text-sm"
          >
            {nextText} →
          </a>
        ) : (
          <span class="btn-outline text-sm opacity-50 cursor-not-allowed">
            {nextText} →
          </span>
        )}
      </div>
    </nav>
  );
};

/**
 * Simple "Load More" style pagination
 */
export interface LoadMoreProps {
  c: Context;
  /** URL for loading more items */
  href: string;
  /** Whether there are more items to load */
  hasMore: boolean;
  /** Button text */
  text?: string;
}

export const LoadMore: FC<LoadMoreProps> = ({
  c,
  href,
  hasMore,
  text,
}) => {
  const i18n = getI18n(c);
  if (!hasMore) {
    return null;
  }

  const buttonText = text ?? i18n._(msg({ message: "Load more", comment: "@context: Pagination button - load more items" }));

  return (
    <div class="text-center py-4">
      <a href={href} class="btn-outline">
        {buttonText}
      </a>
    </div>
  );
};

/**
 * Page-based pagination (for search results etc.)
 */
export interface PagePaginationProps {
  c: Context;
  /** Base URL (query params will be added) */
  baseUrl: string;
  /** Current page (1-indexed) */
  currentPage: number;
  /** Whether there are more pages */
  hasMore: boolean;
  /** Page parameter name (default: "page") */
  pageParam?: string;
}

export const PagePagination: FC<PagePaginationProps> = ({
  c,
  baseUrl,
  currentPage,
  hasMore,
  pageParam = "page",
}) => {
  const i18n = getI18n(c);
  const hasPrev = currentPage > 1;
  const hasNext = hasMore;

  if (!hasPrev && !hasNext) {
    return null;
  }

  // Build URL with page parameter
  const buildUrl = (page: number) => {
    const url = new URL(baseUrl, "http://localhost");
    if (page > 1) {
      url.searchParams.set(pageParam, String(page));
    } else {
      url.searchParams.delete(pageParam);
    }
    return `${url.pathname}${url.search}`;
  };

  const prevText = i18n._(msg({ message: "Previous", comment: "@context: Pagination button - previous page" }));
  const nextText = i18n._(msg({ message: "Next", comment: "@context: Pagination button - next page" }));
  const pageText = i18n._(msg({ message: "Page {page}", comment: "@context: Pagination - current page indicator" }) as any, { page: String(currentPage) });

  return (
    <nav class="flex items-center justify-between py-4" aria-label="Pagination">
      <div>
        {hasPrev ? (
          <a
            href={buildUrl(currentPage - 1)}
            class="btn-outline text-sm"
          >
            ← {prevText}
          </a>
        ) : (
          <span class="btn-outline text-sm opacity-50 cursor-not-allowed">
            ← {prevText}
          </span>
        )}
      </div>

      <span class="text-sm text-muted-foreground">
        {pageText}
      </span>

      <div>
        {hasNext ? (
          <a
            href={buildUrl(currentPage + 1)}
            class="btn-outline text-sm"
          >
            {nextText} →
          </a>
        ) : (
          <span class="btn-outline text-sm opacity-50 cursor-not-allowed">
            {nextText} →
          </span>
        )}
      </div>
    </nav>
  );
};
