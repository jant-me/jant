import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { CollectionDirectoryItem } from "../../types.js";
import {
  getCollectionPagePath,
  getCollectionSelectionPath,
} from "../../lib/collection-paths.js";
import { getIconSvg } from "../../lib/icons.js";
import {
  describeSmartCollection,
  getSmartCollectionLabels,
} from "./smart-collection-labels.js";
import { getDividerCollectionGroup } from "../../lib/collection-groups.js";
import { render as renderMarkdown } from "../../lib/markdown.js";
import { formatRelativeAge, toISOString } from "../../lib/time.js";
import { toPublicHref, toPublicPath, toSameSitePath } from "../../lib/url.js";

export interface CollectionDirectoryProps {
  items: CollectionDirectoryItem[];
  emptyMessage?: string;
  sitePathPrefix?: string;
  /**
   * Public path prefix for collection links, carrying the language prefix in a
   * language view.
   *
   * Required rather than defaulting to `sitePathPrefix`: forgetting it does not
   * fail, it silently links a reader in `/en` back into the primary view, which
   * is a bug that looks like a working link. Pass `navData.basePath`.
   */
  basePath: string;
  siteOrigin?: string;
}

const hasDirectoryContent = (items: CollectionDirectoryItem[]) =>
  items.some(
    (item) =>
      (item.type === "collection" && item.collection) ||
      (item.type === "smart_collection" && item.smartCollection) ||
      (item.type === "link" && item.label && item.url),
  );

/**
 * Compute group-aware sequence labels for directory items.
 *
 * Numbering scheme: each divider starts a new group (0-indexed). Items before
 * the first divider belong to group 0. The label concatenates the group index
 * and the item index within that group, each zero-padded to a width determined
 * by the largest value across all groups (adaptive width).
 *
 * @example
 *   // Two groups, ≤10 items each → "00 01 02 … 10 11 12"
 *   // A group with 11+ items    → "000 001 … 010 … 100 101"
 */
const computeSequenceLabels = (items: CollectionDirectoryItem[]): string[] => {
  const isContentItem = (item: CollectionDirectoryItem) =>
    (item.type === "collection" && item.collection) ||
    (item.type === "smart_collection" && item.smartCollection) ||
    (item.type === "link" && item.label && item.url);

  // First pass: determine group sizes.
  // Each divider starts a new group. Items before the first divider are
  // ungrouped and get a flat sequence (group width 0).
  const groupSizes: number[] = [];
  let seenDivider = false;
  let ungroupedCount = 0;
  for (const item of items) {
    if (item.type === "divider") {
      seenDivider = true;
      groupSizes.push(0);
    } else if (isContentItem(item)) {
      if (seenDivider) {
        const lastGroupIndex = groupSizes.length - 1;
        const lastGroupSize = groupSizes[lastGroupIndex];
        if (lastGroupSize !== undefined) {
          groupSizes[lastGroupIndex] = lastGroupSize + 1;
        }
      } else {
        ungroupedCount += 1;
      }
    }
  }

  const hasGroups = groupSizes.length > 0;

  // Grouped items use a compact base-36 scheme: the group index becomes the
  // leading digit(s) and the item index within the group is a single base-36
  // character (0-9, a-z).  This keeps labels fixed-width at 2 chars for up to
  // 36 groups × 36 items, with hex-style overflow (4a, 4b, …) when a group
  // exceeds 10 items.
  //
  // Ungrouped items (no dividers) use plain decimal, zero-padded to min 2.
  const maxGroupIndex = Math.max(0, groupSizes.length - 1);
  const groupWidth = hasGroups
    ? Math.max(1, maxGroupIndex.toString(36).length)
    : 0;
  const ungroupedItemWidth = Math.max(
    2,
    String(Math.max(0, ungroupedCount - 1)).length,
  );

  // Second pass: assign labels
  const labels: string[] = [];
  let groupIndex = -1;
  let itemIndex = 0;

  for (const item of items) {
    if (item.type === "divider") {
      groupIndex += 1;
      itemIndex = 0;
      labels.push("");
    } else if (isContentItem(item)) {
      if (hasGroups) {
        const g = Math.max(0, groupIndex)
          .toString(36)
          .padStart(groupWidth, "0");
        const i = itemIndex.toString(36);
        labels.push(g + i);
      } else {
        labels.push(String(itemIndex).padStart(ungroupedItemWidth, "0"));
      }
      itemIndex += 1;
    } else {
      labels.push("");
    }
  }

  return labels;
};

export const CollectionDirectory: FC<CollectionDirectoryProps> = ({
  items,
  emptyMessage,
  sitePathPrefix = "",
  basePath,
  siteOrigin = "",
}) => {
  const { i18n } = useLingui();

  if (!hasDirectoryContent(items)) {
    return (
      <p class="text-muted-foreground">
        {emptyMessage ??
          i18n._(
            msg({
              message:
                "No collections yet. Start one to organize threads by topic.",
              comment: "@context: Empty state message on collections page",
            }),
          )}
      </p>
    );
  }

  const sequenceLabels = computeSequenceLabels(items);

  return (
    <div class="collection-directory">
      {items.map((item, index) => {
        if (item.type === "divider") {
          const hasLabel = !!item.label;
          const group = getDividerCollectionGroup(items, index);
          return (
            <div key={item.id} class="collection-directory-divider">
              <div
                class="collection-directory-divider-row"
                aria-hidden={hasLabel ? undefined : "true"}
              >
                {hasLabel ? (
                  <>
                    {group ? (
                      <a
                        href={toPublicPath(
                          getCollectionSelectionPath(group.slugExpression),
                          basePath,
                        )}
                        class="collection-directory-divider-link collection-directory-divider-text"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <span class="collection-directory-divider-text">
                        {item.label}
                      </span>
                    )}
                    <hr class="collection-directory-divider-line" />
                  </>
                ) : (
                  <hr class="collection-directory-divider-line" />
                )}
              </div>
            </div>
          );
        }

        if (item.type === "link" && item.label && item.url) {
          const sequence = sequenceLabels[index];
          // A full URL pointing at this site's own origin is really internal,
          // so render it without external-link affordances.
          const sameSitePath = toSameSitePath(item.url, siteOrigin);
          const linkHref =
            sameSitePath !== null
              ? toPublicHref(sameSitePath, sitePathPrefix)
              : toPublicHref(item.url, sitePathPrefix);
          const isExternal =
            sameSitePath === null &&
            (item.url.startsWith("http://") || item.url.startsWith("https://"));

          return (
            <div
              key={item.id}
              class="collection-directory-item collection-directory-item-link"
            >
              <div class="collection-directory-main">
                <span class="collection-directory-sequence" aria-hidden="true">
                  {sequence}
                </span>
                <div class="collection-directory-title-row">
                  <a
                    href={linkHref}
                    class="collection-directory-title-link"
                    {...(isExternal
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    <span class="collection-directory-title">
                      {item.label}
                      <span
                        class="collection-directory-title-marker"
                        aria-hidden="true"
                      >
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
                          <path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.08L11.7 5.24" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-2.92 2.92a5 5 0 0 0 7.07 7.08l1.69-1.7" />
                        </svg>
                      </span>
                    </span>
                  </a>
                </div>
                {item.description ? (
                  <div
                    class="collection-directory-description prose"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(item.description, {
                        namespace: item.id,
                      }),
                    }}
                  />
                ) : (
                  <p class="collection-directory-summary">
                    <span class="collection-directory-meta">
                      {i18n._(
                        msg({
                          message: "Link",
                          comment:
                            "@context: Default type label for a custom link on the collections directory when no description is provided",
                        }),
                      )}
                    </span>
                  </p>
                )}
              </div>
            </div>
          );
        }

        if (item.type === "smart_collection") {
          const smartCollection = item.smartCollection;
          if (!smartCollection) return null;
          const sequence = sequenceLabels[index];
          // The full sentence is the marker's tooltip; its accessible name is
          // just the kind, because the marker sits inside the title link and a
          // whole sentence there would swamp the link's name.
          const conditions = describeSmartCollection(
            smartCollection.selection,
            i18n,
          );
          const smartCollectionNoun = getSmartCollectionLabels(i18n).noun;

          return (
            <div
              key={item.id}
              class="collection-directory-item"
              data-smart-collection={smartCollection.slug}
            >
              <div class="collection-directory-main">
                <span class="collection-directory-sequence" aria-hidden="true">
                  {sequence}
                </span>
                <div class="collection-directory-title-row">
                  <a
                    href={toPublicPath(
                      getCollectionPagePath(smartCollection.slug),
                      basePath,
                    )}
                    class="collection-directory-title-link"
                  >
                    <span class="collection-directory-title">
                      {smartCollection.title}
                      {/* Shown to every reader, not only the author: which
                          kind of collection this is changes how the list
                          reads. It goes in the same slot the link rows put
                          their marker in, which centres it on the title
                          without any arithmetic. */}
                      <span
                        class="collection-directory-smart-icon"
                        title={conditions}
                        aria-label={smartCollectionNoun}
                        role="img"
                        dangerouslySetInnerHTML={{
                          __html: getIconSvg("funnel", "icon-fine") ?? "",
                        }}
                      />
                    </span>
                  </a>
                </div>
                {smartCollection.description && (
                  <div
                    class="collection-directory-description prose"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(smartCollection.description, {
                        namespace: smartCollection.id,
                      }),
                    }}
                  />
                )}
                <p class="collection-directory-summary">
                  <span class="collection-directory-meta">
                    {smartCollection.threadCount}{" "}
                    {smartCollection.threadCount === 1
                      ? i18n._(
                          msg({
                            message: "thread",
                            comment: "@context: Singular thread count label",
                          }),
                        )
                      : i18n._(
                          msg({
                            message: "threads",
                            comment: "@context: Plural thread count label",
                          }),
                        )}
                  </span>
                </p>
              </div>
            </div>
          );
        }

        const collection = item.collection;
        if (!collection) return null;
        const sequence = sequenceLabels[index];

        return (
          <div key={item.id} class="collection-directory-item">
            <div class="collection-directory-main">
              <span class="collection-directory-sequence" aria-hidden="true">
                {sequence}
              </span>
              <div class="collection-directory-title-row">
                <a
                  href={toPublicPath(
                    getCollectionSelectionPath(collection.slug),
                    basePath,
                  )}
                  class="collection-directory-title-link"
                >
                  <span class="collection-directory-title">
                    {collection.title}
                  </span>
                </a>
              </div>
              {collection.description && (
                <div
                  class="collection-directory-description prose"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(collection.description, {
                      namespace: collection.id,
                    }),
                  }}
                />
              )}
              <p class="collection-directory-summary">
                <span class="collection-directory-meta">
                  {collection.threadCount}{" "}
                  {collection.threadCount === 1
                    ? i18n._(
                        msg({
                          message: "thread",
                          comment: "@context: Singular thread count label",
                        }),
                      )
                    : i18n._(
                        msg({
                          message: "threads",
                          comment: "@context: Plural thread count label",
                        }),
                      )}
                </span>
                <span
                  class="collection-directory-meta-separator"
                  aria-hidden="true"
                >
                  /
                </span>
                <time
                  class="collection-directory-updated"
                  dateTime={toISOString(collection.recentActivityAt)}
                >
                  {formatRelativeAge(collection.recentActivityAt)}
                </time>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
