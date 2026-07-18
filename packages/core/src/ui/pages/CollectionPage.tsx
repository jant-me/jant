/**
 * Collection Page
 *
 * Collection header with breadcrumb, description, sorting, and timeline feed.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { CollectionPageProps } from "../../types.js";
import {
  getCollectionEditPath,
  getCollectionSelectionPath,
  getCollectionsDirectoryPath,
} from "../../lib/collection-paths.js";
import { render as renderMarkdown } from "../../lib/markdown.js";
import { formatPageLabel } from "../../lib/pagination.js";
import { toPublicPath } from "../../lib/url.js";
import { TimelineFeed } from "../feed/TimelineFeed.js";
import { getCollectionMutationLabels } from "../shared/collection-management-labels.js";
import { getIconSvg } from "../../lib/icons.js";

const escapeJson = (data: unknown) =>
  JSON.stringify(data).replace(/</g, "\\u003c");

export const CollectionPage: FC<CollectionPageProps> = ({
  collections,
  items,
  totalThreadCount,
  currentPage,
  totalPages,
  pagePath,
  baseUrl,
  currentSort,
  defaultSort,
  showRatingSort,
  isAuthenticated,
  sitePathPrefix = "",
}) => {
  const primaryCollection = collections[0];
  if (!primaryCollection) return null;

  const { i18n } = useLingui();
  const isAggregate = collections.length > 1;
  const selectionTitle = isAggregate
    ? i18n._(
        msg({
          message: "Combined Collections",
          comment:
            "@context: Page heading when viewing multiple collections together",
        }),
      )
    : collections.map((collection) => collection.title).join(" + ");
  const collectionUrl = toPublicPath(pagePath, sitePathPrefix);
  const editCollectionUrl = toPublicPath(
    `${getCollectionEditPath(primaryCollection.slug)}?returnTo=${encodeURIComponent(
      collectionUrl,
    )}`,
    sitePathPrefix,
  );
  const sortUiId = isAggregate
    ? collections.map((collection) => collection.slug).join("-")
    : primaryCollection.id;
  const sortTriggerId = `collection-sort-trigger-${sortUiId}`;
  const sortPopoverId = `collection-sort-popover-${sortUiId}`;
  const pageLabel =
    currentPage > 1 ? formatPageLabel(currentPage, totalPages) : null;
  const mutationLabels = getCollectionMutationLabels(i18n);
  const newPostLabel = i18n._(
    msg({
      message: "New post",
      comment: "@context: Collection page quick compose button aria label",
    }),
  );
  const sortOptions = [
    {
      value: "newest",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14" />
          <path d="m7 10 5-5 5 5" />
        </svg>
      ),
      label: i18n._(
        msg({
          message: "Newest first",
          comment: "@context: Collection sort order option",
        }),
      ),
    },
    {
      value: "oldest",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14" />
          <path d="m7 14 5 5 5-5" />
        </svg>
      ),
      label: i18n._(
        msg({
          message: "Oldest first",
          comment: "@context: Collection sort order option",
        }),
      ),
    },
    ...(showRatingSort
      ? [
          {
            value: "rating_desc",
            icon: (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m12 3.5 2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.73 6.8 19.5l.99-5.78-4.21-4.1 5.82-.85L12 3.5Z" />
              </svg>
            ),
            label: i18n._(
              msg({
                message: "Highest rated",
                comment: "@context: Collection sort order option",
              }),
            ),
          },
        ]
      : []),
  ] as const;
  const currentSortLabel =
    sortOptions.find((option) => option.value === currentSort)?.label ??
    sortOptions[0].label;

  return (
    <div
      class="py-6"
      data-page="collection"
      data-collection-mode={isAggregate ? "aggregate" : "single"}
      data-collection-id={isAggregate ? undefined : primaryCollection.id}
      data-collection-slugs={collections
        .map((collection) => collection.slug)
        .join(",")}
    >
      <header class="collection-page-header">
        <div class="collection-page-topbar">
          <nav
            class="collection-breadcrumb"
            aria-label={i18n._(
              msg({
                message: "Breadcrumb",
                comment: "@context: Breadcrumb label on collection detail page",
              }),
            )}
          >
            <ol>
              <li>
                <a
                  href={toPublicPath(
                    getCollectionsDirectoryPath(),
                    sitePathPrefix,
                  )}
                >
                  {i18n._(
                    msg({
                      message: "Collections",
                      comment: "@context: Breadcrumb link to collections page",
                    }),
                  )}
                </a>
              </li>
              <li aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </li>
              <li>
                <span>{selectionTitle}</span>
              </li>
            </ol>
          </nav>
        </div>

        <div class="collection-page-title-block">
          <h1 class="collection-page-title">
            <span>{selectionTitle}</span>
          </h1>
          {!isAggregate && primaryCollection.description ? (
            <div
              class="collection-page-description prose"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(primaryCollection.description),
              }}
            />
          ) : null}
          {isAggregate ? (
            <div class="collection-page-meta">
              <span>
                {i18n._(
                  msg({
                    message: "Includes",
                    comment:
                      "@context: Label above the included collections list on an aggregate collection page",
                  }),
                )}
              </span>{" "}
              {collections.map((collection, index) => (
                <span key={collection.id}>
                  {index > 0 ? <span>, </span> : null}
                  <a
                    href={toPublicPath(
                      getCollectionSelectionPath(collection.slug),
                      sitePathPrefix,
                    )}
                  >
                    {collection.title}
                  </a>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div class="collection-page-subhead">
          <div class="collection-page-meta-row">
            <p class="collection-page-meta">
              {isAggregate ? (
                <>
                  {collections.length}{" "}
                  {collections.length === 1
                    ? i18n._(
                        msg({
                          message: "collection",
                          comment:
                            "@context: Singular collection count label on an aggregate collection page",
                        }),
                      )
                    : i18n._(
                        msg({
                          message: "collections",
                          comment:
                            "@context: Plural collection count label on an aggregate collection page",
                        }),
                      )}
                  <span> / </span>
                </>
              ) : null}
              {totalThreadCount}{" "}
              {totalThreadCount === 1
                ? i18n._(
                    msg({
                      message: "thread",
                      comment:
                        "@context: Singular thread count label on collection detail page",
                    }),
                  )
                : i18n._(
                    msg({
                      message: "threads",
                      comment:
                        "@context: Plural thread count label on collection detail page",
                    }),
                  )}
              {pageLabel ? <span> / {pageLabel}</span> : null}{" "}
              <a
                href={toPublicPath(`${pagePath}/feed`, sitePathPrefix)}
                class="feed-link"
                title={i18n._(
                  msg({
                    message: "RSS feed",
                    comment:
                      "@context: Tooltip for the RSS feed link on a collection page",
                  }),
                )}
                rel="noopener noreferrer"
              >
                <span
                  dangerouslySetInnerHTML={{
                    __html: getIconSvg("rss") ?? "",
                  }}
                />
              </a>
            </p>
            <span class="collection-page-meta-divider" aria-hidden="true">
              &middot;
            </span>
            <div class="dropdown-menu collection-sort-menu">
              <button
                type="button"
                id={sortTriggerId}
                class="collection-sort-trigger"
                aria-haspopup="menu"
                aria-controls={sortPopoverId}
                aria-expanded="false"
              >
                <span class="sr-only">
                  {i18n._(
                    msg({
                      message: "Sort",
                      comment:
                        "@context: Sort menu label on collection detail page",
                    }),
                  )}
                  :{" "}
                </span>
                <span>{currentSortLabel}</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              <div
                id={sortPopoverId}
                class="collection-sort-popover"
                data-popover
                data-align="end"
                aria-hidden="true"
              >
                <div
                  class="collection-sort-options"
                  role="menu"
                  aria-labelledby={sortTriggerId}
                  data-collection-sort-options
                >
                  {sortOptions.map((option) => (
                    <a
                      key={option.value}
                      href={
                        option.value === defaultSort
                          ? collectionUrl
                          : `${collectionUrl}?sort=${option.value}`
                      }
                      role="menuitem"
                      class={`collection-sort-option ${
                        option.value === currentSort
                          ? "collection-sort-option-active"
                          : ""
                      }`}
                      aria-current={
                        option.value === currentSort ? "true" : undefined
                      }
                    >
                      <span class="collection-sort-option-leading">
                        <span class="collection-sort-option-icon">
                          {option.icon}
                        </span>
                        <span>{option.label}</span>
                      </span>
                      {option.value === currentSort ? (
                        <span
                          class="collection-sort-option-check"
                          aria-hidden="true"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.25"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path d="m5 12 4.2 4.2L19 6.5" />
                          </svg>
                        </span>
                      ) : null}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {isAuthenticated && !isAggregate ? (
            <div class="collection-page-owner-tools">
              <button
                type="button"
                class="collection-page-compose-trigger"
                aria-label={newPostLabel}
                title={newPostLabel}
                data-on:click={`document.getElementById('compose-dialog')?.querySelector('jant-compose-dialog')?.openNew(${escapeJson({ collectionId: primaryCollection.id })})`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>

              <div
                class="collection-page-manage"
                data-collection-page-actions
                data-collection-id={primaryCollection.id}
                data-collection-page-labels={escapeJson(mutationLabels)}
                data-collection-page-redirect-url={toPublicPath(
                  getCollectionsDirectoryPath(),
                  sitePathPrefix,
                )}
              >
                <button
                  type="button"
                  class="collection-page-manage-trigger"
                  aria-label={mutationLabels.moreActions}
                  aria-expanded="false"
                  aria-haspopup="menu"
                  data-collection-page-action="toggle-menu"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <circle cx="5" cy="12" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="19" cy="12" r="2" />
                  </svg>
                </button>

                <div
                  class="collections-page-menu"
                  role="menu"
                  data-collection-page-menu
                  hidden
                >
                  <a
                    href={editCollectionUrl}
                    class="collections-page-menu-item"
                    role="menuitem"
                  >
                    <span
                      class="collections-page-menu-item-icon"
                      aria-hidden="true"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </span>
                    <span class="collections-page-menu-item-label">
                      {mutationLabels.edit}
                    </span>
                  </a>
                  <button
                    type="button"
                    class="collections-page-menu-item collections-page-menu-item-danger"
                    role="menuitem"
                    data-collection-page-action="delete"
                  >
                    <span
                      class="collections-page-menu-item-icon"
                      aria-hidden="true"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                      </svg>
                    </span>
                    <span class="collections-page-menu-item-label">
                      {mutationLabels.deleteCollection}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <main>
        {items.length === 0 ? (
          <p class="text-muted-foreground">
            {isAggregate
              ? i18n._(
                  msg({
                    message:
                      "Nothing here yet. Add threads to one of these collections to fill this view.",
                    comment:
                      "@context: Empty state message on an aggregate collection page",
                  }),
                )
              : i18n._(
                  msg({
                    message:
                      "This collection is empty. Add threads from the editor.",
                    comment: "@context: Empty state message",
                  }),
                )}
          </p>
        ) : (
          <TimelineFeed
            items={items}
            baseUrl={baseUrl}
            currentPage={currentPage}
            totalPages={totalPages}
          />
        )}
      </main>
    </div>
  );
};
