/**
 * Home Page
 *
 * Timeline feed with per-type card components and thread previews.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { HomePageProps } from "../../types.js";
import { TimelineFeed } from "../feed/TimelineFeed.js";
import { PaginatedPageHeader } from "../shared/PaginatedPageHeader.js";

export const HomePage: FC<HomePageProps> = ({
  items,
  baseUrl,
  currentPage,
  totalPages,
  isAuthenticated,
  signinUrl,
}) => {
  const { i18n } = useLingui();

  return (
    <div>
      <PaginatedPageHeader
        title={i18n._(
          msg({
            message: "Latest",
            comment: "@context: Page heading for the latest posts feed",
          }),
        )}
        currentPage={currentPage}
        totalPages={totalPages}
        hideOnFirstPage
        showTitle={false}
      />
      {items.length === 0 ? (
        <div data-feed>
          <div id="timeline-feed">
            <div id="timeline-items" class="flex flex-col">
              <p id="empty-timeline" class="pt-0 pb-8 text-muted-foreground">
                {i18n._(
                  msg({
                    message: "Quiet here for now.",
                    comment: "@context: Empty state message on home page",
                  }),
                )}{" "}
                {isAuthenticated ? (
                  i18n._(
                    msg({
                      message: "Write your first post to get started.",
                      comment:
                        "@context: Nudge shown to the signed-in site owner on an empty home page, pointing to the compose prompt above the feed",
                    }),
                  )
                ) : (
                  <a href={signinUrl} class="underline underline-offset-2">
                    {i18n._(
                      msg({
                        message: "Sign in to start writing.",
                        comment:
                          "@context: Sign-in nudge shown to visitors on an empty home page, hinting that the site owner can sign in to start writing",
                      }),
                    )}
                  </a>
                )}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <TimelineFeed
          items={items}
          baseUrl={baseUrl}
          currentPage={currentPage}
          totalPages={totalPages}
        />
      )}
    </div>
  );
};
