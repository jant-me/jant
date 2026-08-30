/**
 * Collections Listing Page
 *
 * Single-column directory of collections.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { CollectionsPageProps } from "../../types.js";
import { CollectionDirectory } from "../shared/CollectionDirectory.js";
import { CollectionsManager } from "../shared/CollectionsManager.js";

export const CollectionsPage: FC<CollectionsPageProps> = ({
  items,
  isAuthenticated,
  navigationCollectionIds = [],
  feedsEnabled = false,
  sitePathPrefix = "",
  basePath = sitePathPrefix,
  siteOrigin = "",
}) => {
  const { i18n } = useLingui();
  const emptyMessage = i18n._(
    msg({
      message: "No collections yet. Start one to organize threads by topic.",
      comment: "@context: Empty state message on collections page",
    }),
  );

  if (isAuthenticated) {
    return (
      <div class="py-6" data-page="collections">
        <CollectionsManager
          items={items}
          navigationCollectionIds={navigationCollectionIds}
          sitePathPrefix={sitePathPrefix}
          basePath={basePath}
          siteOrigin={siteOrigin}
        />
      </div>
    );
  }

  return (
    <div class="py-6" data-page="collections">
      <div class="collections-page-shell">
        <header class="collections-page-header">
          <div class="collections-page-heading page-intro">
            <div class="page-intro-title-row">
              <h1 class="page-intro-title">
                {i18n._(
                  msg({
                    message: "Collections",
                    comment: "@context: Collections page heading",
                  }),
                )}
              </h1>
            </div>
          </div>
        </header>

        <CollectionDirectory
          items={items}
          emptyMessage={emptyMessage}
          sitePathPrefix={sitePathPrefix}
          basePath={basePath}
          siteOrigin={siteOrigin}
          feedsEnabled={feedsEnabled}
        />
      </div>
    </div>
  );
};
