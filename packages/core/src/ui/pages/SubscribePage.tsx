import type { FC } from "hono/jsx";
import { msg } from "@lingui/core/macro";
import { useLingui } from "../../i18n/context.js";
import { CopyField } from "../shared/CopyField.js";
import { PaginatedPageHeader } from "../shared/PaginatedPageHeader.js";

/** One feed offered on this page. */
export interface SubscribeFeed {
  /** What to call it, as the reader would ask for it. */
  label: string;
  /** Absolute address, for pasting into a reader. */
  url: string;
  /** One line on what this feed carries that the others do not. */
  description: string;
}

export interface SubscribePageProps {
  /**
   * The feed to lead with — whichever `/feed` currently returns. Presented on
   * its own because the page's job is to answer "which one do I use", and a
   * menu of equals hands that question back to the reader.
   */
  mainFeed: SubscribeFeed;
  /**
   * The other two, at lower visual weight: the opposite end of the same list
   * from the main feed, and the complete record.
   */
  otherFeeds: readonly SubscribeFeed[];
}

/**
 * How to follow this site.
 *
 * Every address here is rendered by the server. This page is its addresses —
 * there is nothing else on it — so none of them may wait for JavaScript.
 *
 * @param props - The main feed and the two shown beneath it
 * @returns The subscribe page content
 */
export const SubscribePage: FC<SubscribePageProps> = ({
  mainFeed,
  otherFeeds,
}) => {
  const { i18n } = useLingui();

  const copyLabel = i18n._(
    msg({
      message: "Copy",
      comment: "@context: Button that copies a feed address to the clipboard",
    }),
  );
  const copiedMessage = i18n._(
    msg({
      message: "Feed URL copied.",
      comment: "@context: Toast after copying a feed URL to the clipboard",
    }),
  );
  const failedMessage = i18n._(
    msg({
      message: "Could not copy. Select the address and copy it.",
      comment:
        "@context: Toast when the clipboard is unavailable, pointing at selecting the address by hand",
    }),
  );

  return (
    <div data-page="subscribe">
      <PaginatedPageHeader
        title={i18n._(
          msg({
            message: "Subscribe",
            comment: "@context: Page title for the feed subscription page",
          }),
        )}
        description={i18n._(
          msg({
            message: "Put an address into any feed reader.",
            comment:
              "@context: Subscribe page introduction, above the feed addresses",
          }),
        )}
      />

      <div class="card p-5">
        <CopyField
          label={mainFeed.label}
          value={mainFeed.url}
          description={mainFeed.description}
          copyLabel={copyLabel}
          copiedMessage={copiedMessage}
          failedMessage={failedMessage}
        />
      </div>

      <div class="mt-8 flex flex-col gap-5">
        {otherFeeds.map((feed) => (
          <CopyField
            key={feed.url}
            label={feed.label}
            value={feed.url}
            description={feed.description}
            copyLabel={copyLabel}
            copiedMessage={copiedMessage}
            failedMessage={failedMessage}
          />
        ))}
      </div>

      <p class="mt-8 text-sm text-muted-foreground">
        {i18n._(
          msg({
            message:
              "Collections and filtered archive views have their own feeds. Look for the feed icon on those pages.",
            comment:
              "@context: Subscribe page closing note, pointing at the per-page feed icons instead of listing every collection",
          }),
        )}
      </p>
    </div>
  );
};
