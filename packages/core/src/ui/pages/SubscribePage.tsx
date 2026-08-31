import type { FC } from "hono/jsx";
import { msg } from "@lingui/core/macro";
import { useLingui } from "../../i18n/context.js";
import { getIconSvg } from "../../lib/icons.js";
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
 * The page's measure.
 *
 * The addresses are copy fields — a read-only input with the button laid over
 * its right edge — and the site's content column runs to 1088px. Left at full
 * width the button sits some 700px from the address it copies, and three of
 * them stacked read as a settings form. 576px holds a long site URL with a
 * language prefix whole while keeping the button next to its address.
 */
const COLUMN_CLASS = "max-w-xl";

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
    <div data-page="subscribe" class={COLUMN_CLASS}>
      <PaginatedPageHeader
        title={i18n._(
          msg({
            message: "Subscribe",
            comment: "@context: Page title for the feed subscription page",
          }),
        )}
        // The page is about feeds and carried no feed mark at all. It also
        // ends by telling the reader to look for this glyph elsewhere, which
        // only works once they have seen it here.
        iconHtml={
          getIconSvg("rss", "size-6 text-muted-foreground") ?? undefined
        }
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

      <p class="mt-8 flex items-start gap-2 text-sm text-muted-foreground">
        {/* The specimen the sentence points at. Decorative — the sentence
            names it, so a screen reader announcing the glyph twice would only
            get in the way. */}
        <span
          class="mt-0.5 shrink-0 opacity-70"
          aria-hidden="true"
          dangerouslySetInnerHTML={{
            __html: getIconSvg("rss", "size-3.5") ?? "",
          }}
        />
        <span>
          {i18n._(
            msg({
              message:
                "Collections and filtered archive views have their own feeds. Look for this icon on those pages.",
              comment:
                "@context: Subscribe page closing note, next to a small feed icon standing in for the ones on collection and archive pages",
            }),
          )}
        </span>
      </p>

      {/* Last, under a rule: a reader who already keeps a feed reader never
          has to read it, and one who does not can find it by its heading.
          Naming specific readers was considered and dropped — the list would
          be identical on every Jant site, which makes the software the one
          endorsing them, and it would rot as readers shut down or change
          hands. */}
      <section class="mt-10 border-t pt-6">
        <h2 class="text-base font-medium">
          {i18n._(
            msg({
              message: "What a feed reader does",
              comment:
                "@context: Subscribe page heading over the explanation of feed readers, for readers who have not used one",
            }),
          )}
        </h2>
        <p class="mt-2 text-sm text-muted-foreground">
          {i18n._(
            msg({
              message:
                "A feed reader checks these addresses for new posts and collects them in one place. Most are an app on your phone or computer; some are a website you sign in to.",
              comment:
                "@context: Subscribe page explanation of what a feed reader is and where it runs",
            }),
          )}
        </p>
        <p class="mt-2 text-sm text-muted-foreground">
          {i18n._(
            msg({
              message:
                "Subscribing creates no account here. To stop, delete the address from your reader.",
              comment:
                "@context: Subscribe page note that subscribing is one-sided and how to undo it",
            }),
          )}
        </p>
      </section>
    </div>
  );
};
