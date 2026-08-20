import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { CollectionDirectoryItem } from "../../types.js";
import {
  getCollectionsDirectoryPath,
  getNewCollectionPath,
} from "../../lib/collection-paths.js";
import { toPublicPath } from "../../lib/url.js";
import { CollectionDirectory } from "./CollectionDirectory.js";
import { getCollectionMutationLabels } from "./collection-management-labels.js";
import {
  getSmartCollectionDialogLabels,
  getSmartCollectionLabels,
} from "./smart-collection-labels.js";
import { getIconSvg } from "../../lib/icons.js";

const escapeJson = (data: unknown) =>
  JSON.stringify(data).replace(/</g, "\\u003c");

export interface CollectionsManagerProps {
  items: CollectionDirectoryItem[];
  navigationCollectionIds?: string[];
  sitePathPrefix?: string;
  /**
   * Site path prefix plus the language prefix of the view being rendered.
   * Collection pages exist once per language, so a reader on `/en/collections`
   * must land on `/en/{slug}` rather than being dropped into the primary view.
   * Required for the same reason as on {@link CollectionDirectoryProps}.
   */
  basePath: string;
  siteOrigin?: string;
}

export const CollectionsManager: FC<CollectionsManagerProps> = ({
  items,
  navigationCollectionIds = [],
  sitePathPrefix = "",
  basePath,
  siteOrigin = "",
}) => {
  const { i18n } = useLingui();
  const collectionsHref = toPublicPath(
    getCollectionsDirectoryPath(),
    sitePathPrefix,
  );
  const newCollectionHref = toPublicPath(
    `${getNewCollectionPath()}?returnTo=${encodeURIComponent(collectionsHref)}`,
    sitePathPrefix,
  );
  const mutationLabels = getCollectionMutationLabels(i18n);

  const smartLabels = getSmartCollectionLabels(i18n);
  const labels = {
    collectionsTitle: i18n._(
      msg({
        message: "Collections",
        comment: "@context: Collections page heading",
      }),
    ),
    newSmartCollection: smartLabels.newSmartCollection,
    editSmartCollection: smartLabels.editSmartCollection,
    deleteSmartCollection: smartLabels.deleteSmartCollection,
    confirmDeleteSmartCollection: smartLabels.confirmDelete,
    turnIntoSmartCollection: smartLabels.turnIntoSmartCollection,
    smartCollectionDeleted: i18n._(
      msg({
        message: "Smart collection deleted.",
        comment: "@context: Confirmation after deleting a smart collection",
      }),
    ),
    organize: i18n._(
      msg({
        message: "Organize",
        comment: "@context: Menu action to organize collections",
      }),
    ),
    done: i18n._(
      msg({
        message: "Done",
        comment: "@context: Button to exit collection organize mode",
      }),
    ),
    organizeHint: i18n._(
      msg({
        message:
          "Drag collections, links, and dividers into the order you want.",
        comment: "@context: Helper text shown while organizing collections",
      }),
    ),
    newDivider: i18n._(
      msg({
        message: "New Divider",
        comment:
          "@context: Menu action to create a divider on collections page",
      }),
    ),
    newLink: i18n._(
      msg({
        message: "New Link",
        comment:
          "@context: Menu action to create a custom link on collections page",
      }),
    ),
    dividerLabel: i18n._(
      msg({
        message: "Divider",
        comment:
          "@context: Label for a divider item while organizing collections",
      }),
    ),
    dividerLabelPlaceholder: i18n._(
      msg({
        message: "Label (optional)",
        comment:
          "@context: Placeholder for an optional divider label in collections organize mode",
      }),
    ),
    newCollection: i18n._(
      msg({
        message: "New Collection",
        comment:
          "@context: Button to create a collection from collections page",
      }),
    ),
    deleteDivider: i18n._(
      msg({
        message: "Remove Divider",
        comment: "@context: Tooltip for divider delete button",
      }),
    ),
    threadSingular: i18n._(
      msg({
        message: "thread",
        comment: "@context: Singular thread count label",
      }),
    ),
    threadPlural: i18n._(
      msg({
        message: "threads",
        comment: "@context: Plural thread count label",
      }),
    ),
    emptyState: i18n._(
      msg({
        message: "No collections yet. Start one to organize threads by topic.",
        comment: "@context: Empty state message on collections page",
      }),
    ),
    orderSaved: i18n._(
      msg({
        message: "Collection order updated.",
        comment: "@context: Toast after reordering collections",
      }),
    ),
    notNow: i18n._(
      msg({
        message: "Not now",
        comment:
          "@context: Action to dismiss the post-create Collection navigation prompt",
      }),
    ),
    ...mutationLabels,
  };

  return (
    <div class="collections-page-shell" data-collections-manager-root>
      <header class="collections-page-header">
        <div class="collections-page-heading page-intro">
          <div class="page-intro-title-row">
            <h1 class="page-intro-title">{labels.collectionsTitle}</h1>
            <div class="collections-page-actions">
              <div
                class="collections-page-action-group"
                data-collections-reorder-actions
                hidden
              >
                <button
                  type="button"
                  class="btn-outline"
                  data-collections-action="divider"
                >
                  {labels.newDivider}
                </button>
                <button
                  type="button"
                  class="btn-outline"
                  data-collections-action="done"
                >
                  {labels.done}
                </button>
              </div>
              <div
                class="collections-page-action-group"
                data-collections-toolbar
              >
                <a
                  href={newCollectionHref}
                  class="collections-page-toolbar-button"
                  aria-label={labels.newCollection}
                  title={labels.newCollection}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
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
                </a>
                <div class="relative">
                  <button
                    type="button"
                    class="collections-page-toolbar-button"
                    aria-label={labels.moreActions}
                    aria-expanded="false"
                    aria-haspopup="menu"
                    title={labels.moreActions}
                    data-collections-action="toggle-menu"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
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
                    data-collections-more-menu
                    hidden
                  >
                    <button
                      type="button"
                      class="collections-page-menu-item"
                      data-collections-action="organize"
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
                          <path d="M8 6h13" />
                          <path d="M8 12h13" />
                          <path d="M8 18h13" />
                          <path d="M3 6h.01" />
                          <path d="M3 12h.01" />
                          <path d="M3 18h.01" />
                        </svg>
                      </span>
                      <span class="collections-page-menu-item-label">
                        {labels.organize}
                      </span>
                    </button>
                    {/* Beside Add link and Add divider, not a second `+`:
                        the `+` is where a collection is created, and two plus
                        signs would immediately raise "which plus". */}
                    <button
                      type="button"
                      class="collections-page-menu-item"
                      data-collections-action="smart-collection"
                    >
                      <span
                        class="collections-page-menu-item-icon"
                        aria-hidden="true"
                        dangerouslySetInnerHTML={{
                          __html: getIconSvg("list-filter") ?? "",
                        }}
                      />
                      <span class="collections-page-menu-item-label">
                        {smartLabels.newSmartCollection}
                      </span>
                    </button>
                    <button
                      type="button"
                      class="collections-page-menu-item"
                      data-collections-action="link"
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
                          <path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.08L11.7 5.24" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-2.92 2.92a5 5 0 0 0 7.07 7.08l1.69-1.7" />
                        </svg>
                      </span>
                      <span class="collections-page-menu-item-label">
                        {labels.newLink}
                      </span>
                    </button>
                    <button
                      type="button"
                      class="collections-page-menu-item"
                      data-collections-action="divider"
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
                          <path d="M4 8h16" />
                          <path d="M4 16h6" />
                          <path d="M14 16h6" />
                        </svg>
                      </span>
                      <span class="collections-page-menu-item-label">
                        {labels.newDivider}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p class="page-intro-description" data-collections-hint hidden>
            {labels.organizeHint}
          </p>
        </div>
      </header>

      {/* The dialog is a Lit component and cannot reach the i18n catalogs, so
          the page that can open it carries its strings. */}
      <div
        hidden
        data-smart-collection-dialog-labels={escapeJson(
          getSmartCollectionDialogLabels(i18n),
        )}
      />

      <jant-collections-manager
        items={escapeJson(items)}
        labels={escapeJson(labels)}
        navigation-collection-ids={escapeJson(navigationCollectionIds)}
      >
        <CollectionDirectory
          items={items}
          emptyMessage={labels.emptyState}
          sitePathPrefix={sitePathPrefix}
          basePath={basePath}
          siteOrigin={siteOrigin}
        />
      </jant-collections-manager>
    </div>
  );
};
