/**
 * Featured Page
 *
 * Shows featured posts as a timeline feed.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { FeaturedPageProps } from "../../types.js";
import { TimelineFeed } from "../feed/TimelineFeed.js";
import { PaginatedPageHeader } from "../shared/PaginatedPageHeader.js";

export const FeaturedPage: FC<FeaturedPageProps> = ({
  items,
  currentPage,
  totalPages,
  baseUrl,
}) => {
  const { i18n } = useLingui();

  return (
    <div>
      <PaginatedPageHeader
        title={i18n._(
          msg({
            message: "Featured",
            comment: "@context: Page heading for the featured posts feed",
          }),
        )}
        currentPage={currentPage}
        totalPages={totalPages}
        hideOnFirstPage
        showTitle={false}
      />
      <main>
        {items.length === 0 ? (
          <p class="text-muted-foreground">
            {i18n._(
              msg({
                message:
                  "Nothing in Featured yet. Mark a post as featured to show it here.",
                comment: "@context: Empty state message on featured page",
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
