/**
 * Smart Collection Page
 *
 * The same shape as a collection page — title, description, thread count, feed
 * link, timeline — minus the archive's chip bar. A collection page has no
 * filter bar either, and this one is not a place to filter: the conditions are
 * edited in a dialog.
 *
 * What marks it as smart is the funnel after the title, the same marker the
 * directory puts on a smart row, and the same tooltip. The conditions
 * themselves stand in for a description the owner has not written; once one is
 * written, it takes the slot and the marker carries the signal alone.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { SmartCollectionPageProps } from "../../types.js";
import { getCollectionsDirectoryPath } from "../../lib/collection-paths.js";
import { render as renderMarkdown } from "../../lib/markdown.js";
import { formatPageLabel } from "../../lib/pagination.js";
import { toPublicPath } from "../../lib/url.js";
import { TimelineFeed } from "../feed/TimelineFeed.js";
import { getCollectionMutationLabels } from "../shared/collection-management-labels.js";
import {
  getSmartCollectionDialogLabels,
  getSmartCollectionLabels,
} from "../shared/smart-collection-labels.js";
import { getIconSvg } from "../../lib/icons.js";
import { Icon } from "../shared/Icon.js";
import { NAVIGATION_SETTINGS_PATH } from "../../lib/settings-paths.js";

const escapeJson = (data: unknown) =>
  JSON.stringify(data).replace(/</g, "\\u003c");

export const SmartCollectionPage: FC<SmartCollectionPageProps> = ({
  smartCollection,
  items,
  totalThreadCount,
  currentPage,
  totalPages,
  pagePath,
  baseUrl,
  currentSort,
  defaultSort,
  showRatingSort,
  conditionSummary,
  conditionHref,
  isAuthenticated,
  isInNavigation = false,
  sitePathPrefix = "",
  basePath = sitePathPrefix,
  feedHref,
}) => {
  const { i18n } = useLingui();
  const labels = getSmartCollectionLabels(i18n);
  const mutationLabels = getCollectionMutationLabels(i18n);
  const pageUrl = toPublicPath(pagePath, basePath);
  const navigationSettingsUrl = toPublicPath(
    NAVIGATION_SETTINGS_PATH,
    sitePathPrefix,
  );
  const sortTriggerId = `smart-collection-sort-trigger-${smartCollection.id}`;
  const sortPopoverId = `smart-collection-sort-popover-${smartCollection.id}`;
  const pageLabel =
    currentPage > 1 ? formatPageLabel(currentPage, totalPages) : null;

  const sortOptions = [
    {
      value: "newest",
      label: i18n._(
        msg({
          message: "Newest first",
          comment: "@context: Collection sort order option",
        }),
      ),
    },
    {
      value: "oldest",
      label: i18n._(
        msg({
          message: "Oldest first",
          comment: "@context: Collection sort order option",
        }),
      ),
    },
    {
      value: "updated",
      label: i18n._(
        msg({
          message: "Recently updated",
          comment:
            "@context: Smart collection sort order option — threads that changed most recently",
        }),
      ),
    },
    ...(showRatingSort
      ? [
          {
            value: "rating_desc",
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
      // The same page kind a theme already styles; the second attribute is the
      // hook for anything that needs to tell the two apart.
      data-page="collection"
      data-smart-collection={smartCollection.slug}
      data-collection-mode="smart"
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
                <a href={toPublicPath(getCollectionsDirectoryPath(), basePath)}>
                  {i18n._(
                    msg({
                      message: "Collections",
                      comment: "@context: Breadcrumb link to collections page",
                    }),
                  )}
                </a>
              </li>
              <li aria-hidden="true">
                <Icon name="chevron-right" size={14} />
              </li>
              <li>
                <span>{smartCollection.title}</span>
              </li>
            </ol>
          </nav>
        </div>

        <div class="collection-page-title-block">
          <h1 class="collection-page-title">
            <span>
              {smartCollection.title}
              {/* The marker every reader gets, in the same slot and the same
                  words the directory uses: which kind of collection this is
                  changes how an absence reads. Unlike the directory's — which
                  sits inside the row's link and so cannot be one itself — this
                  one carries the way to the archive, so a description written
                  over the condition line does not take it away. */}
              <a
                href={toPublicPath(conditionHref, basePath)}
                class="collection-page-smart-icon"
                title={conditionSummary}
                aria-label={conditionSummary}
                dangerouslySetInnerHTML={{
                  __html: getIconSvg("funnel", "icon-fine") ?? "",
                }}
              />
            </span>
          </h1>
          {smartCollection.description ? (
            <div
              class="collection-page-description prose"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(smartCollection.description, {
                  namespace: smartCollection.id,
                }),
              }}
            />
          ) : (
            /* Nothing written, so the conditions describe the page — and the
               link is there for a reader who wants to narrow further, since
               the archive already reads this vocabulary. */
            <p class="collection-page-description smart-collection-conditions">
              <a href={toPublicPath(conditionHref, basePath)}>
                {conditionSummary}
              </a>
            </p>
          )}
        </div>

        <div class="collection-page-subhead">
          <div class="collection-page-meta-row">
            <p class="collection-page-meta">
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
              {pageLabel ? <span> / {pageLabel}</span> : null}
              {feedHref ? (
                <>
                  {" "}
                  <a
                    href={toPublicPath(feedHref, basePath)}
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
                </>
              ) : null}
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
                <Icon name="chevron-down" size={14} />
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
                          ? pageUrl
                          : `${pageUrl}?sort=${option.value}`
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
                        <span>{option.label}</span>
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {isAuthenticated ? (
            <div class="collection-page-owner-tools">
              {/* The dialog is a Lit component and cannot reach the i18n
                  catalogs, so the page that can open it carries its strings. */}
              <div
                hidden
                data-smart-collection-dialog-labels={escapeJson(
                  getSmartCollectionDialogLabels(i18n),
                )}
              />
              <div
                class="collection-page-manage"
                data-smart-collection-page-actions
                data-smart-collection-id={smartCollection.id}
                data-collection-page-labels={escapeJson({
                  ...mutationLabels,
                  confirmDelete: labels.confirmDelete,
                  deleteCollection: labels.deleteSmartCollection,
                  deleted: i18n._(
                    msg({
                      message: "Smart collection deleted.",
                      comment:
                        "@context: Confirmation after deleting a smart collection",
                    }),
                  ),
                })}
                data-collection-in-navigation={String(isInNavigation)}
                data-collection-page-redirect-url={toPublicPath(
                  getCollectionsDirectoryPath(),
                  basePath,
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
                  {/* Opens the dialog rather than navigating: there is no
                      editor page, so creating and editing are one surface. */}
                  <button
                    type="button"
                    class="collections-page-menu-item"
                    role="menuitem"
                    data-collection-page-action="edit"
                  >
                    <span
                      class="collections-page-menu-item-icon"
                      aria-hidden="true"
                    >
                      <Icon name="pencil" />
                    </span>
                    <span class="collections-page-menu-item-label">
                      {mutationLabels.edit}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="collections-page-menu-item"
                    role="menuitem"
                    data-collection-page-action="add-to-navigation"
                    hidden={isInNavigation}
                  >
                    <span
                      class="collections-page-menu-item-icon"
                      aria-hidden="true"
                    >
                      <Icon name="plus" />
                    </span>
                    <span class="collections-page-menu-item-label">
                      {mutationLabels.addToNavigation}
                    </span>
                  </button>
                  <a
                    href={navigationSettingsUrl}
                    class="collections-page-menu-item"
                    role="menuitem"
                    data-collection-page-edit-navigation
                    hidden={!isInNavigation}
                  >
                    <span
                      class="collections-page-menu-item-icon"
                      aria-hidden="true"
                    >
                      <Icon name="list" />
                    </span>
                    <span class="collections-page-menu-item-label">
                      {mutationLabels.editNavigation}
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
                      <Icon name="trash-2" />
                    </span>
                    <span class="collections-page-menu-item-label">
                      {labels.deleteSmartCollection}
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
          <p class="text-muted-foreground">{labels.emptyMatches}</p>
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
