/**
 * Search Page
 *
 * Dedicated search result UI — compact per-type cards, not full timeline cards.
 * Each card shows only what's relevant: title/domain/quote + FTS snippet.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { SearchPageProps, SearchResultView } from "../../types.js";
import { toPublicPath } from "../../lib/url.js";
import { PagePagination } from "../shared/Pagination.js";
import {
  CompactCollectionTags,
  PostMenuTriggerButton,
} from "../shared/PostFooter.js";
import { getPostArticleAttributes } from "../shared/post-article-attributes.js";

// External link icon (shared by LinkCard)
const ExternalLinkIcon = () => (
  <svg
    class="size-3 shrink-0"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke-width="2"
    stroke="currentColor"
  >
    <path d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
  </svg>
);

const SearchResultCard: FC<{
  result: SearchResultView;
  isAuthenticated?: boolean;
}> = ({ result, isAuthenticated }) => {
  const { post, snippet, titleHighlighted, quoteHighlighted } = result;

  // Extract domain for link posts
  let domain: string | undefined;
  if (post.format === "link" && post.url) {
    try {
      domain = new URL(post.url).hostname.replace(/^www\./, "");
    } catch {
      // Invalid URL, skip
    }
  }

  const isChildPost = !!post.replyToId || !!post.threadRootId;
  const visibleCollections = isChildPost ? [] : post.collections;
  const hasCollections = visibleCollections.length > 0;

  const postAttrs = getPostArticleAttributes(post);

  const footer = (
    <footer class="post-menu-footer mt-2">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <span class="badge-outline">{post.format}</span>
        <a href={post.permalink} class="hover:underline">
          <time datetime={post.publishedAt}>{post.publishedAtFormatted}</time>
        </a>
        <CompactCollectionTags
          collections={visibleCollections}
          showSeparator={hasCollections}
        />
      </div>
      {isAuthenticated && (
        <div class="post-menu-actions">
          <PostMenuTriggerButton />
        </div>
      )}
    </footer>
  );

  // ── Link ──────────────────────────────────────────────────────────────────
  if (post.format === "link") {
    return (
      <article {...postAttrs}>
        {domain && (
          <div class="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <ExternalLinkIcon />
            <span>{domain}</span>
          </div>
        )}
        {(titleHighlighted ?? post.title) && (
          <h3 class="font-semibold text-lg mb-1">
            {titleHighlighted ? (
              <a
                href={post.url || post.permalink}
                target={post.url ? "_blank" : undefined}
                rel={post.url ? "noopener noreferrer" : undefined}
                class="hover:underline"
                dangerouslySetInnerHTML={{ __html: titleHighlighted }}
              />
            ) : (
              <a
                href={post.url || post.permalink}
                target={post.url ? "_blank" : undefined}
                rel={post.url ? "noopener noreferrer" : undefined}
                class="hover:underline"
              >
                {post.title}
              </a>
            )}
          </h3>
        )}
        {snippet && (
          <p
            class="search-snippet"
            dangerouslySetInnerHTML={{ __html: snippet }}
          />
        )}
        {footer}
      </article>
    );
  }

  // ── Quote ─────────────────────────────────────────────────────────────────
  if (post.format === "quote") {
    return (
      <article {...postAttrs}>
        {quoteHighlighted && (
          <blockquote class="feed-quote mb-1">
            <p
              class="text-base"
              dangerouslySetInnerHTML={{ __html: quoteHighlighted }}
            />
            {post.title && (
              <footer class="text-xs text-muted-foreground mt-1">
                {post.url ? (
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="hover:underline"
                  >
                    — {post.title}
                  </a>
                ) : (
                  <span>— {post.title}</span>
                )}
              </footer>
            )}
          </blockquote>
        )}
        {snippet && (
          <p
            class="search-snippet"
            dangerouslySetInnerHTML={{ __html: snippet }}
          />
        )}
        {footer}
      </article>
    );
  }

  // ── Note with title (article) ─────────────────────────────────────────────
  if (post.title) {
    return (
      <article {...postAttrs}>
        <h3 class="font-semibold text-lg mb-1">
          {titleHighlighted ? (
            <a
              href={post.permalink}
              class="hover:underline"
              dangerouslySetInnerHTML={{ __html: titleHighlighted }}
            />
          ) : (
            <a href={post.permalink} class="hover:underline">
              {post.title}
            </a>
          )}
        </h3>
        {snippet && (
          <p
            class="search-snippet"
            dangerouslySetInnerHTML={{ __html: snippet }}
          />
        )}
        {footer}
      </article>
    );
  }

  // ── Untitled note ─────────────────────────────────────────────────────────
  // Snippet is the primary content here (no title), so use normal text color.
  return (
    <article {...postAttrs}>
      {snippet ? (
        <a href={post.permalink} class="block hover:opacity-80">
          <p
            class="search-snippet-primary"
            dangerouslySetInnerHTML={{ __html: snippet }}
          />
        </a>
      ) : (
        <a
          href={post.permalink}
          class="block text-sm text-muted-foreground hover:underline"
        >
          {post.publishedAtFormatted}
        </a>
      )}
      {footer}
    </article>
  );
};

export const SearchPage: FC<SearchPageProps> = ({
  query,
  results,
  error,
  hasMore,
  page,
  basePath = "",
  isAuthenticated,
}) => {
  const { i18n } = useLingui();

  return (
    <div class="py-6" data-page="search">
      <h1 class="text-2xl font-semibold mb-6">
        {i18n._(
          msg({
            message: "Search",
            comment: "@context: Search page title",
          }),
        )}
      </h1>

      {/* Search form */}
      <form
        method="get"
        action={toPublicPath("/search", basePath)}
        class="mb-8"
      >
        <div class="flex gap-2">
          <input
            type="search"
            name="q"
            class="input flex-1"
            placeholder={i18n._(
              msg({
                message: "Search posts...",
                comment: "@context: Search input placeholder",
              }),
            )}
            value={query}
            autofocus={!query}
          />
          <button type="submit" class="btn">
            {i18n._(
              msg({
                message: "Search",
                comment: "@context: Search submit button",
              }),
            )}
          </button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div class="alert-destructive mb-6">
          <h2>{error}</h2>
        </div>
      )}

      {/* Results */}
      {query && !error && (
        <div>
          <p class="text-sm text-muted-foreground mb-4">
            {results.length === 0
              ? i18n._(
                  msg({
                    message: "No results. Try different keywords.",
                    comment: "@context: Search empty results",
                  }),
                )
              : i18n._(
                  msg({
                    message:
                      "{count, plural, one {Found # result} other {Found # results}}",
                    comment: "@context: Search results count - multiple",
                  }),
                  {
                    count: results.length,
                  },
                )}
          </p>

          {results.length > 0 && (
            <>
              <div class="flex flex-col divide-y divide-border">
                {results.map((result) => (
                  <div key={result.post.id} class="py-4 first:pt-0 last:pb-0">
                    <SearchResultCard
                      result={result}
                      isAuthenticated={isAuthenticated}
                    />
                  </div>
                ))}
              </div>

              <PagePagination
                baseUrl={
                  toPublicPath("/search", basePath) +
                  "?q=" +
                  encodeURIComponent(query)
                }
                currentPage={page}
                hasMore={hasMore}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};
