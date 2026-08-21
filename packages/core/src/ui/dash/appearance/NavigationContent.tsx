/**
 * Navigation management: Lit-powered reorderable nav items, add area, system toggles
 */

import { msg } from "@lingui/core/macro";
import { useLingui } from "../../../i18n/context.js";
import type {
  CollectionsDirectoryData,
  NavItem,
  SuggestedNavLink,
  SystemNavKey,
} from "../../../types.js";
import { SYSTEM_NAV_KEYS } from "../../../types.js";
import { getSmartCollectionLabels } from "../../shared/smart-collection-labels.js";
import type {
  NavManagerCollection,
  NavManagerLabels,
  NavManagerSuggestedLink,
  SystemNavConfig,
} from "../../../client/components/nav-manager-types.js";
import type { CollectionFormLabels } from "../../../client/components/collection-types.js";
import { toPublicHref, toPublicPath } from "../../../lib/url.js";
import {
  getCollectionDialogLabels,
  getCollectionFormLabels,
} from "../../shared/collection-management-labels.js";
import {
  getNavItemDisplayLabel,
  getSystemNavDescription,
  getSystemNavDisplayLabel,
  NAV_MORE_LABEL,
} from "../../shared/navigation-labels.js";

// =============================================================================
// Main component
// =============================================================================

export function NavigationContent({
  navItems,
  directoryData,
  suggestedLinks,
  mainRssFeed,
  rssFeedsEnabled,
  siteName,
  sitePathPrefix = "",
}: {
  navItems: NavItem[];
  directoryData: CollectionsDirectoryData;
  suggestedLinks: SuggestedNavLink[];
  mainRssFeed: string;
  rssFeedsEnabled: boolean;
  siteName: string;
  sitePathPrefix?: string;
}) {
  const { i18n } = useLingui();
  const latestLabel = i18n._(
    msg({
      message: "Latest",
      comment: "@context: Browse filter label for latest posts",
    }),
  );
  const featuredLabel = i18n._(
    msg({
      message: "Featured",
      comment: "@context: Browse filter label for featured posts",
    }),
  );
  const previewLabel = i18n._(
    msg({
      message: "Navigation Preview",
      comment: "@context: Label for nav preview section",
    }),
  );
  const moreLabel = i18n._(NAV_MORE_LABEL);
  const createCollectionLabel = i18n._(
    msg({
      message: "Create Collection",
      comment:
        "@context: Button and dialog title for quick collection creation in Navigation settings",
    }),
  );
  const collectionFormLabels: CollectionFormLabels = {
    ...getCollectionFormLabels(i18n),
    titleLabel: i18n._(
      msg({
        message: "Title",
        comment: "@context: Collection title field in Navigation settings",
      }),
    ),
    titlePlaceholder: i18n._(
      msg({
        message: "My Collection",
        comment:
          "@context: Collection title placeholder in Navigation settings",
      }),
    ),
    slugLabel: i18n._(
      msg({
        message: "Collection link",
        comment: "@context: Collection slug field in Navigation settings",
      }),
    ),
    slugHelp: i18n._(
      msg({
        message: "This is the last part of the collection link.",
        comment: "@context: Collection slug help text in Navigation settings",
      }),
    ),
    slugInvalidHelp: i18n._(
      msg({
        message: "Use lowercase letters, numbers, and hyphens only.",
        comment:
          "@context: Collection slug validation error in Navigation settings",
      }),
    ),
    slugReservedHelp: i18n._(
      msg({
        message: "This link is reserved. Choose something else.",
        comment:
          "@context: Reserved collection slug error in Navigation settings",
      }),
    ),
    slugTooLongHelp: i18n._(
      msg({
        message: "Keep this link under 200 characters.",
        comment: "@context: Long collection slug error in Navigation settings",
      }),
    ),
    editSlugLabel: i18n._(
      msg({
        message: "Edit link",
        comment:
          "@context: Button to edit the generated collection slug in Navigation settings",
      }),
    ),
    resetSlugLabel: i18n._(
      msg({
        message: "Reset link",
        comment:
          "@context: Button to reset the collection slug in Navigation settings",
      }),
    ),
    quickHint: i18n._(
      msg({
        message: "More options are available after you create it.",
        comment:
          "@context: Helper text in quick collection creation in Navigation settings",
      }),
    ),
    quickSubmitLabel: createCollectionLabel,
    createdLabel: i18n._(
      msg({
        message: "Collection created.",
        comment:
          "@context: Heading after quick collection creation in Navigation settings",
      }),
    ),
  };

  const suggestedTargetLabels = {
    page: i18n._(
      msg({
        message: "Page",
        comment: "@context: Suggested navigation link target type",
      }),
    ),
    collection: i18n._(
      msg({
        message: "Collection",
        comment: "@context: Suggested navigation link target type",
      }),
    ),
    archive: i18n._(
      msg({
        message: "Archive",
        comment: "@context: Suggested navigation link target type",
      }),
    ),
  } satisfies Record<SuggestedNavLink["targetType"], string>;

  // Serialize nav items for the Lit component
  const itemsData = navItems.map((item) => {
    // System link URLs are always computed from constants, never from DB
    const url =
      item.type === "system" && item.systemKey
        ? (SYSTEM_NAV_KEYS[item.systemKey]?.url ?? item.url)
        : item.url;
    return {
      id: item.id,
      type: item.type,
      systemKey: item.systemKey,
      collectionId: item.collectionId,
      postId: item.postId,
      label: item.label,
      displayLabel: getNavItemDisplayLabel(item, i18n, sitePathPrefix),
      url,
      placement: item.placement ?? "header",
    };
  });

  // Serialize collections in directory order with group labels from dividers
  const collectionsData: NavManagerCollection[] = (() => {
    const { items } = directoryData;
    const result: NavManagerCollection[] = [];
    let currentGroup: string | null = null;

    for (const item of items) {
      if (item.type === "divider") {
        currentGroup = item.label ?? null;
      } else if (item.type === "collection" && item.collection) {
        result.push({
          id: item.collection.id,
          title: item.collection.title,
          slug: item.collection.slug,
          group: currentGroup,
        });
      } else if (item.type === "smart_collection" && item.smartCollection) {
        result.push({
          id: item.smartCollection.id,
          title: item.smartCollection.title,
          slug: item.smartCollection.slug,
          group: currentGroup,
          isSmart: true,
        });
      }
    }

    // Append anything with no directory row, both kinds alike.
    const includedIds = new Set(result.map((c) => c.id));
    for (const c of directoryData.collections) {
      if (!includedIds.has(c.id)) {
        result.push({ id: c.id, title: c.title, slug: c.slug, group: null });
      }
    }
    for (const c of directoryData.smartCollections) {
      if (!includedIds.has(c.id)) {
        result.push({
          id: c.id,
          title: c.title,
          slug: c.slug,
          group: null,
          isSmart: true,
        });
      }
    }

    return result;
  })();

  const suggestedLinksData: NavManagerSuggestedLink[] = suggestedLinks.map(
    (link) => ({
      ...link,
      targetLabel: suggestedTargetLabels[link.targetType],
    }),
  );

  // Build system nav config array for the Lit component
  const systemNavData: SystemNavConfig[] = (
    Object.keys(SYSTEM_NAV_KEYS) as SystemNavKey[]
  ).map((key) => ({
    key,
    label: getSystemNavDisplayLabel(key, i18n),
    description:
      key === "rss"
        ? i18n._(
            msg({
              message:
                "Header RSS points to your {feed} feed (/feed). Change what /feed returns in General.",
              comment:
                "@context: Description for the RSS system navigation toggle. {feed} is either Latest or Featured.",
            }),
            {
              feed: mainRssFeed === "latest" ? latestLabel : featuredLabel,
            },
          )
        : getSystemNavDescription(key, i18n),
  }));

  const labels: NavManagerLabels = {
    preview: previewLabel,
    navigationItems: i18n._(
      msg({
        message: "Navigation items",
        comment: "@context: Section heading for nav items",
      }),
    ),
    emptyState: i18n._(
      msg({
        message:
          "No navigation items yet. Add links or enable system items below.",
        comment: "@context: Empty state for navigation items",
      }),
    ),
    link: i18n._(
      msg({
        message: "link",
        comment: "@context: Nav item type badge",
      }),
    ),
    page: i18n._(
      msg({
        message: "page",
        comment: "@context: Nav item type badge for page items",
      }),
    ),
    system: i18n._(
      msg({
        message: "system",
        comment: "@context: Nav item type badge",
      }),
    ),
    toggleEdit: i18n._(
      msg({
        message: "Toggle edit panel",
        comment: "@context: Button to expand/collapse nav item edit",
      }),
    ),
    label: i18n._(
      msg({
        message: "Label",
        comment: "@context: Nav item label field",
      }),
    ),
    url: i18n._(
      msg({
        message: "URL",
        comment: "@context: Nav item URL field",
      }),
    ),
    save: i18n._(
      msg({
        message: "Save",
        comment: "@context: Save nav item changes",
      }),
    ),
    delete: i18n._(
      msg({
        message: "Delete",
        comment: "@context: Delete nav item",
      }),
    ),
    remove: i18n._(
      msg({
        message: "Remove",
        comment: "@context: Remove system item from navigation",
      }),
    ),
    confirmDeleteLink: i18n._(
      msg({
        message:
          "Delete this navigation link? Visitors won't see it in your site header anymore.",
        comment:
          "@context: Confirm dialog for deleting a custom navigation link",
      }),
    ),
    confirmDeletePage: i18n._(
      msg({
        message:
          "Remove this page from navigation? The page itself won't be deleted.",
        comment: "@context: Confirm dialog for removing a page from navigation",
      }),
    ),
    orderSaved: i18n._(
      msg({
        message: "Navigation order updated.",
        comment: "@context: Toast after saving navigation item order",
      }),
    ),
    labelRequired: i18n._(
      msg({
        message: "Label is required",
        comment: "@context: Error toast when nav label is empty",
      }),
    ),
    saveFailed: i18n._(
      msg({
        message: "Couldn't save. Try again in a moment.",
        comment: "@context: Error toast when nav save fails",
      }),
    ),
    deleteFailed: i18n._(
      msg({
        message: "Couldn't delete. Try again in a moment.",
        comment: "@context: Error toast when nav delete fails",
      }),
    ),
    systemLinks: i18n._(
      msg({
        message: "Built-in links",
        comment: "@context: Section heading for built-in nav items",
      }),
    ),
    systemLinksDescription: i18n._(
      msg({
        message:
          "Show or hide built-in destinations in the header and More menu.",
        comment: "@context: Description for built-in nav toggles",
      }),
    ),
    addCustomLinkToNavigation: i18n._(
      msg({
        message: "Add custom link to navigation",
        comment: "@context: Section heading for adding custom link to nav",
      }),
    ),
    addLink: i18n._(
      msg({
        message: "Add Link",
        comment: "@context: Button and heading for adding custom link",
      }),
    ),
    addLinkDescription: i18n._(
      msg({
        message: "Add a custom link to any URL",
        comment: "@context: Description in link popover form",
      }),
    ),
    urlPlaceholder: "/archive or https://...",
    headerSection: i18n._(
      msg({
        message: "Header",
        comment: "@context: Section label for nav items shown in header",
      }),
    ),
    moreSection: i18n._(
      msg({
        message: "More",
        comment:
          "@context: Section label for nav items hidden under More dropdown",
      }),
    ),
    moreEmptyHint: i18n._(
      msg({
        message: "Drag links here to show them under the More menu",
        comment:
          "@context: Hint text shown in empty More section of nav settings",
      }),
    ),
    placementSaved: i18n._(
      msg({
        message: "Navigation placement updated.",
        comment: "@context: Toast after moving nav item between header/more",
      }),
    ),
    cancel: i18n._(
      msg({
        message: "Cancel",
        comment: "@context: Button label to dismiss a dialog or action",
      }),
    ),
    labelAndUrlRequired: i18n._(
      msg({
        message: "Label and URL are required",
        comment: "@context: Error toast when nav link fields are empty",
      }),
    ),
    suggestedLinks: i18n._(
      msg({
        message: "Suggested links",
        comment: "@context: Section heading for suggested nav links",
      }),
    ),
    suggestedLinksDescription: i18n._(
      msg({
        message: "Add common destinations that already exist on your site.",
        comment: "@context: Description for suggested nav links",
      }),
    ),
    addSuggestedLink: i18n._(
      msg({
        message: "Add",
        comment: "@context: Button to add a suggested nav link",
      }),
    ),
    suggestedLinkAdded: i18n._(
      msg({
        message: "Link added to navigation.",
        comment: "@context: Toast after adding a suggested nav link",
      }),
    ),
    addPageToNavigation: i18n._(
      msg({
        message: "Add page to navigation",
        comment: "@context: Section heading for adding a page to navigation",
      }),
    ),
    addPageDescription: i18n._(
      msg({
        message:
          "Choose a titled note that isn't already in navigation, or create a new page.",
        comment: "@context: Description for adding a page to navigation",
      }),
    ),
    addPage: i18n._(
      msg({
        message: "Add Page",
        comment: "@context: Button that opens the navigation page picker",
      }),
    ),
    searchPages: i18n._(
      msg({
        message: "Search pages",
        comment: "@context: Placeholder for the navigation page search",
      }),
    ),
    searchPagesHint: i18n._(
      msg({
        message: "Search pages, or paste an address",
        comment:
          "@context: Placeholder for the navigation page search, which also accepts a pasted URL or path",
      }),
    ),
    recentPages: i18n._(
      msg({
        message: "Recently updated",
        comment: "@context: Heading above recent pages in the page picker",
      }),
    ),
    addressMatch: i18n._(
      msg({
        message: "At that address",
        comment:
          "@context: Heading above the page a pasted address resolved to",
      }),
    ),
    addressAlreadyAdded: i18n._(
      msg({
        message: "Already in navigation. Drag it in the list above to move it.",
        comment:
          "@context: Shown when a pasted address is already a navigation item",
      }),
    ),
    addressNotFound: i18n._(
      msg({
        message: "Nothing at {address}. Check it, or search by title.",
        comment:
          "@context: Shown when a pasted address matches no page on the site",
      }),
      // Filled in the browser with the address that was looked up.
      { address: "{address}" },
    ),
    addressUnpublished: i18n._(
      msg({
        message: "That page is a draft. Publish it, then add it.",
        comment: "@context: Shown when a pasted address resolves to a draft",
      }),
    ),
    addressPrivate: i18n._(
      msg({
        message: "That page is private, so nobody could open it from a menu.",
        comment:
          "@context: Shown when a pasted address resolves to a private page",
      }),
    ),
    addressUntitled: i18n._(
      msg({
        message: "That page has no title yet, so a menu has nothing to show.",
        comment:
          "@context: Shown when a pasted address resolves to an untitled post",
      }),
    ),
    addressExternal: i18n._(
      msg({
        message:
          "That address is on another site. Navigation holds it as a link.",
        comment: "@context: Shown when a pasted address points off the site",
      }),
    ),
    addressLinkOnly: i18n._(
      msg({
        message: "Navigation holds that address as a link.",
        comment:
          "@context: Shown for a page on the site that can only be a link, such as an archive URL",
      }),
    ),
    addressAddAsLink: i18n._(
      msg({
        message: "Add as link",
        comment:
          "@context: Button that opens the link form with the pasted address filled in",
      }),
    ),
    searchingPages: i18n._(
      msg({
        message: "Searching pages…",
        comment: "@context: Loading state in the navigation page picker",
      }),
    ),
    noMatchingPages: i18n._(
      msg({
        message:
          "No matching pages available to add. Try another title or create a new page.",
        comment: "@context: Empty search results in the page picker",
      }),
    ),
    noPages: i18n._(
      msg({
        message: "No pages available. Create one to add it to navigation.",
        comment: "@context: Empty state in the navigation page picker",
      }),
    ),
    pageSearchFailed: i18n._(
      msg({
        message: "Couldn't load pages. Try again in a moment.",
        comment: "@context: Error shown when navigation page search fails",
      }),
    ),
    createNewPage: i18n._(
      msg({
        message: "Create new page",
        comment: "@context: Action at the bottom of the navigation page picker",
      }),
    ),
    createPage: i18n._(
      msg({
        message: "Create Page",
        comment: "@context: Button and dialog title for quick page creation",
      }),
    ),
    createPageDescription: i18n._(
      msg({
        message: "Create a public page that won't appear in Latest.",
        comment: "@context: Description in the quick-create page dialog",
      }),
    ),
    pageTitle: i18n._(
      msg({
        message: "Title",
        comment: "@context: Title field label in quick page creation",
      }),
    ),
    pageAddress: i18n._(
      msg({
        message: "Page address",
        comment: "@context: Slug field label in quick page creation",
      }),
    ),
    pageVisibilityHint: i18n._(
      msg({
        message: "The page is public but stays out of Latest.",
        comment: "@context: Visibility note in quick page creation",
      }),
    ),
    titleRequired: i18n._(
      msg({
        message: "Enter a page title.",
        comment: "@context: Validation error for an empty quick page title",
      }),
    ),
    slugInvalid: i18n._(
      msg({
        message: "Use lowercase letters, numbers, and hyphens.",
        comment: "@context: Validation error for an invalid page slug",
      }),
    ),
    slugReserved: i18n._(
      msg({
        message: "That address is reserved. Choose another one.",
        comment: "@context: Validation error for a reserved page slug",
      }),
    ),
    slugTooLong: i18n._(
      msg({
        message: "Keep the page address under 200 characters.",
        comment: "@context: Validation error for a long page slug",
      }),
    ),
    slugUnavailable: i18n._(
      msg({
        message: "That address is already in use. Choose another one.",
        comment: "@context: Validation error for an unavailable page slug",
      }),
    ),
    checkingAddress: i18n._(
      msg({
        message: "Checking address…",
        comment: "@context: Loading text while checking page slug availability",
      }),
    ),
    creatingPage: i18n._(
      msg({
        message: "Creating page…",
        comment: "@context: Loading label while creating a page",
      }),
    ),
    createPageFailed: i18n._(
      msg({
        message: "Couldn't create the page. Check the details and try again.",
        comment: "@context: Error when quick page creation fails",
      }),
    ),
    pageCreated: i18n._(
      msg({
        message: "Page created.",
        comment: "@context: Heading after quick page creation",
      }),
    ),
    pageCreatedDescription: i18n._(
      msg({
        message: "Add it to navigation now or open the editor to add content.",
        comment: "@context: Description after quick page creation",
      }),
    ),
    addToNavigation: i18n._(
      msg({
        message: "Add to Navigation",
        comment: "@context: Button that adds a created page to navigation",
      }),
    ),
    editPage: i18n._(
      msg({
        message: "Edit Page",
        comment: "@context: Button that opens a page for editing",
      }),
    ),
    pageAdded: i18n._(
      msg({
        message: "Page added to navigation.",
        comment: "@context: Confirmation after adding a page to navigation",
      }),
    ),
    back: i18n._(
      msg({
        message: "Back",
        comment: "@context: Button returning from page creation to page search",
      }),
    ),
    collection: i18n._(
      msg({
        message: "collection",
        comment: "@context: Nav item type badge for collection items",
      }),
    ),
    addCollection: i18n._(
      msg({
        message: "Add Collection",
        comment: "@context: Button for adding a collection to nav",
      }),
    ),
    smartCollectionLabel: getSmartCollectionLabels(i18n).noun,
    addCollectionToNavigation: i18n._(
      msg({
        message: "Add collection to navigation",
        comment: "@context: Section heading for adding a collection to nav",
      }),
    ),
    addCollectionDescription: i18n._(
      msg({
        message:
          "Pin a collection to your navigation bar. An asterisk (*) appears next to collections updated in the last 48 hours.",
        comment: "@context: Description in collection picker section",
      }),
    ),
    allCollectionsAdded: i18n._(
      msg({
        message: "All collections are already in your navigation.",
        comment:
          "@context: Message when every collection is already added to nav",
      }),
    ),
    noCollections: i18n._(
      msg({
        message: "No collections yet. Create one here to add it to navigation.",
        comment:
          "@context: Empty state when no collections exist for nav picker",
      }),
    ),
    createNewCollection: i18n._(
      msg({
        message: "Create new collection",
        comment:
          "@context: Action at the bottom of the Navigation collection picker",
      }),
    ),
    createCollection: createCollectionLabel,
    creatingCollection: i18n._(
      msg({
        message: "Creating collection…",
        comment:
          "@context: Loading label while creating a collection in Navigation settings",
      }),
    ),
    createCollectionFailed: i18n._(
      msg({
        message:
          "Couldn't create the collection. Check the details and try again.",
        comment:
          "@context: Error when quick collection creation fails in Navigation settings",
      }),
    ),
    collectionCreatedDescription: i18n._(
      msg({
        message: "Add it to navigation now or open the editor to add details.",
        comment:
          "@context: Description after quick collection creation in Navigation settings",
      }),
    ),
    editCollection: i18n._(
      msg({
        message: "Edit Collection",
        comment:
          "@context: Button that opens a newly created collection for editing",
      }),
    ),
    collectionAdded: i18n._(
      msg({
        message: "Collection added to navigation.",
        comment:
          "@context: Confirmation after adding a collection to navigation",
      }),
    ),
    collectionFormLabels,
    confirmDeleteCollection: i18n._(
      msg({
        message:
          "Remove this collection from navigation? The collection itself won't be deleted.",
        comment: "@context: Confirm dialog for removing a collection nav item",
      }),
    ),
  };

  const escapeJson = (data: unknown) =>
    JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <div class="max-w-3xl flex flex-col gap-8">
      {/* The dialog is a Lit component and cannot reach the i18n catalogs, so
          the page that can open it carries its strings. */}
      <div
        hidden
        data-collection-dialog-labels={escapeJson(
          getCollectionDialogLabels(i18n),
        )}
      />
      <jant-nav-manager
        items={escapeJson(itemsData)}
        labels={escapeJson(labels)}
        system-nav-items={escapeJson(systemNavData)}
        collections={escapeJson(collectionsData)}
        suggested-links={escapeJson(suggestedLinksData)}
        site-name={siteName}
        rss-feeds-enabled={rssFeedsEnabled || undefined}
      >
        {/* SSR fallback: static preview until JS hydrates */}
        {(() => {
          const previewItems = rssFeedsEnabled
            ? navItems
            : navItems.filter(
                (item) => item.type !== "system" || item.systemKey !== "rss",
              );
          const headerNavItems = previewItems.filter(
            (item) => item.placement !== "more",
          );
          const moreNavItems = previewItems.filter(
            (item) => item.placement === "more",
          );
          return (
            <div class="nav-preview">
              <div class="nav-preview-chrome">
                <div class="nav-preview-dots">
                  <span />
                  <span />
                  <span />
                </div>
                <span class="nav-preview-label">{previewLabel}</span>
              </div>
              <div class="nav-preview-content">
                <div class="site-header-top">
                  <a href={toPublicPath("/", sitePathPrefix)} class="site-logo">
                    {siteName}
                  </a>
                  <nav class="site-header-nav">
                    {headerNavItems.map((item, index) => (
                      <a
                        key={item.id}
                        href={toPublicHref(item.url, sitePathPrefix)}
                        class={`site-header-link${index === 0 ? " site-header-link-active" : ""}`}
                      >
                        {getNavItemDisplayLabel(item, i18n, sitePathPrefix)}
                      </a>
                    ))}
                    {moreNavItems.length > 0 && (
                      <div class="site-header-more">
                        <button
                          type="button"
                          class="site-header-more-btn"
                          aria-haspopup="menu"
                          aria-expanded="false"
                        >
                          {moreLabel}{" "}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                        <div
                          class="site-header-more-popover"
                          aria-hidden="true"
                        >
                          {moreNavItems.map((item) => (
                            <span key={item.id} class="site-header-more-link">
                              {getNavItemDisplayLabel(
                                item,
                                i18n,
                                sitePathPrefix,
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </nav>
                </div>
              </div>
            </div>
          );
        })()}
      </jant-nav-manager>
    </div>
  );
}
