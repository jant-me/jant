/**
 * General settings form
 *
 * Server-side template that renders the <jant-settings-general> Lit
 * component for site name, description, footer, homepage branding, language,
 * timezone, and search settings.
 * The settings-bridge.ts script handles server communication.
 */

import { msg } from "@lingui/core/macro";
import { useLingui } from "../../../i18n/context.js";
import type { TimezoneEntry } from "../../../lib/timezones.js";
import type { AboutPageStatus } from "../../../services/about-page.js";
import type { DiscoverMode } from "../../../lib/discover.js";
import { getJantDocsUrl } from "../../../lib/jant-docs.js";

const FEEDS_DOCS_URL = getJantDocsUrl("feeds");

/**
 * Where the site stands in the directory, as far as the site itself can tell.
 *
 * Every field is local evidence. The directory takes no status queries — see
 * `docs/discover.md` — so nothing here is fetched, and nothing here can say
 * whether a person has moderated the site.
 */
export interface DiscoverStatus {
  /** Last announcement succeeded, failed, or was never made. */
  announced: boolean | null;
  /** Why the last announcement failed. */
  announceError: string | null;
  /** Unix seconds of the last announcement attempt. */
  announceAt: number | null;
  /** A directory is configured at all. */
  hasDirectory: boolean;
  /** The directory's manual submission form, when there is one. */
  submitUrl: string | null;
  /** What this site's feeds actually declare right now. */
  declaredMode: DiscoverMode;
  publicPostCount: number;
  /** Featured thread roots — what a `featured` feed would actually carry. */
  featuredPostCount: number;
  firstReadMaxHours: number;
}

export function GeneralContent({
  siteName,
  siteDescription,
  siteNameFallback,
  siteDescriptionFallback,
  mainRssFeed,
  mainFeedUrl,
  latestFeedUrl,
  featuredFeedUrl,
  archiveFeedUrl,
  timeZone,
  siteFooter,
  showJantBrandingOnHome,
  noindex,
  discover,
  discoverDocsUrl,
  discoverStatus,
  rssFeedsEnabled,
  demoMode,
  timezones,
  aboutPage,
  aboutEditUrl,
  aboutCreateUrl,
}: {
  siteName: string;
  siteDescription: string;
  siteNameFallback: string;
  siteDescriptionFallback: string;
  mainRssFeed: string;
  mainFeedUrl: string;
  latestFeedUrl: string;
  featuredFeedUrl: string;
  archiveFeedUrl: string;
  timeZone: string;
  siteFooter: string;
  showJantBrandingOnHome: boolean;
  noindex: boolean;
  /** The stored choice, or "" when the owner has never used the control. */
  discover: string;
  discoverDocsUrl: string;
  discoverStatus: DiscoverStatus;
  rssFeedsEnabled: boolean;
  demoMode: boolean;
  timezones: TimezoneEntry[];
  aboutPage: AboutPageStatus;
  aboutEditUrl: string;
  aboutCreateUrl: string;
}) {
  const { i18n } = useLingui();

  const labels = JSON.stringify({
    general: i18n._(
      msg({
        message: "General",
        comment: "@context: Settings section heading",
      }),
    ),
    site: i18n._(
      msg({
        message: "Site",
        comment: "@context: Settings subsection heading for basic site fields",
      }),
    ),
    aboutPage: i18n._(
      msg({
        message: "About page",
        comment: "@context: Link label for editing or creating the About page",
      }),
    ),
    aboutPagePrompt: i18n._(
      msg({
        message: "Want to write a fuller introduction?",
        comment:
          "@context: Prompt shown below the short site description, before the About page action",
      }),
    ),
    createAboutPage: i18n._(
      msg({
        message: "Create About page",
        comment: "@context: Button to create the standard About page",
      }),
    ),
    editAboutPage: i18n._(
      msg({
        message: "Edit About page",
        comment: "@context: Link to edit the standard About page",
      }),
    ),
    aboutPageConflict: i18n._(
      msg({
        message:
          "/about is already used. Rename that item before creating an About page.",
        comment: "@context: Compact conflict message when /about is occupied",
      }),
    ),
    timeSection: i18n._(
      msg({
        message: "Time",
        comment:
          "@context: Settings subsection heading for the time zone field",
      }),
    ),
    home: i18n._(
      msg({
        message: "Home",
        comment: "@context: Settings subsection heading for home page settings",
      }),
    ),
    search: i18n._(
      msg({
        message: "Site visibility",
        comment:
          "@context: Settings section heading covering search engine indexing and the Jant Discover directory",
      }),
    ),
    siteName: i18n._(
      msg({
        message: "Site Name",
        comment: "@context: Settings form field",
      }),
    ),
    aboutBlog: i18n._(
      msg({
        message: "About this blog",
        comment: "@context: Settings form field for site description",
      }),
    ),
    aboutBlogHelp: i18n._(
      msg({
        message: "A short intro shown on your home page.",
        comment: "@context: Help text for site description field",
      }),
    ),
    timeZone: i18n._(
      msg({
        message: "Time Zone",
        comment: "@context: Settings form field",
      }),
    ),
    siteFooter: i18n._(
      msg({
        message: "Site Footer",
        comment: "@context: Settings section heading for site footer",
      }),
    ),
    feeds: i18n._(
      msg({
        message: "Feeds",
        comment:
          "@context: Settings section heading for RSS feed configuration",
      }),
    ),
    mainRssFeed: i18n._(
      msg({
        message: "Main RSS feed",
        comment:
          "@context: Settings field label for the canonical /feed output",
      }),
    ),
    mainRssFeedHelp: i18n._(
      msg({
        message: "This controls what /feed returns.",
        comment:
          "@context: Help text for choosing whether /feed points to latest or featured posts",
      }),
    ),
    mainRssFeedWarning: i18n._(
      msg({
        message: "Changing this updates what subscribers get from /feed.",
        comment:
          "@context: Warning shown when changing the canonical RSS feed selection",
      }),
    ),
    availableFeedUrls: i18n._(
      msg({
        message: "Fixed feed URLs",
        comment: "@context: Label for the list of stable RSS feed URLs",
      }),
    ),
    feedsDocs: i18n._(
      msg({
        message: "All feed addresses",
        comment:
          "@context: Link text to the feeds documentation, under the fixed feed URLs in General settings",
      }),
    ),
    availableFeedUrlsHelp: i18n._(
      msg({
        message: "Use these when you want a feed URL that never changes.",
        comment:
          "@context: Help text for the explicit latest and featured feed URLs",
      }),
    ),
    mainFeedUrl: i18n._(
      msg({
        message: "Main feed",
        comment: "@context: Label for the canonical /feed URL",
      }),
    ),
    latestFeedUrl: i18n._(
      msg({
        message: "Latest feed",
        comment: "@context: Label for the explicit latest RSS feed URL",
      }),
    ),
    featuredFeedUrl: i18n._(
      msg({
        message: "Featured feed",
        comment: "@context: Label for the explicit featured RSS feed URL",
      }),
    ),
    archiveFeedUrl: i18n._(
      msg({
        message: "Archive feed",
        comment: "@context: Label for the full-archive RSS feed URL",
      }),
    ),
    archiveFeedUrlHelp: i18n._(
      msg({
        message: "Every published post, including ones hidden from Latest.",
        comment:
          "@context: Help text under the archive feed URL, explaining it is the complete feed",
      }),
    ),
    latestFeedOption: i18n._(
      msg({
        message: "Latest",
        comment:
          "@context: Select option for using latest posts as the main RSS feed",
      }),
    ),
    latestFeedOptionDescription: i18n._(
      msg({
        message: "Uses the latest public posts for /feed.",
        comment:
          "@context: Description for choosing the latest posts as the main RSS feed",
      }),
    ),
    featuredFeedOption: i18n._(
      msg({
        message: "Featured",
        comment:
          "@context: Select option for using featured posts as the main RSS feed",
      }),
    ),
    featuredFeedOptionDescription: i18n._(
      msg({
        message: "Uses featured posts for /feed.",
        comment:
          "@context: Description for choosing featured posts as the main RSS feed",
      }),
    ),
    footerHelp: i18n._(
      msg({
        message: "Displayed at the bottom of all posts and pages.",
        comment: "@context: Help text for site footer field",
      }),
    ),
    showJantBrandingOnHome: i18n._(
      msg({
        message: 'Show "Build with Jant" at the bottom of the home page',
        comment:
          "@context: Checkbox for showing the optional Jant credit link on the home page",
      }),
    ),
    markdownSupported: i18n._(
      msg({
        message: "Markdown supported",
        comment: "@context: Placeholder hint for markdown-enabled textareas",
      }),
    ),
    allowIndexing: i18n._(
      msg({
        message: "Allow search engines to index my site",
        comment: "@context: Checkbox for allowing search engine indexing",
      }),
    ),
    demoSeoLocked: i18n._(
      msg({
        message: "Demo sites always stay hidden from search engines.",
        comment:
          "@context: Help text explaining that SEO indexing is locked in demo mode",
      }),
    ),
    discoverEnabled: i18n._(
      msg({
        message: "Show my site and posts in Jant Discover",
        comment: "@context: Checkbox for joining the Jant Discover directory",
      }),
    ),
    discoverIntro: i18n._(
      msg({
        message:
          "Discover is a public list of Jant blogs. It shows one of your posts at a time, never sooner than a day after you publish it, and links back to your site.",
        comment:
          "@context: Introduction to the Jant Discover settings section. Deliberately states only the stable promises; the tunable intervals live in the docs.",
      }),
    ),
    discoverAnnounce: i18n._(
      msg({
        message:
          "Turning this on sends your feed address to the directory once, so it knows your site exists.",
        comment:
          "@context: Help text saying plainly what enabling Jant Discover transmits",
      }),
    ),
    discoverDocs: i18n._(
      msg({
        message: "How Discover picks posts",
        comment: "@context: Link to the Jant Discover documentation page",
      }),
    ),
    discoverLatest: i18n._(
      msg({
        message: "Latest",
        comment:
          "@context: Jant Discover option drawing from the site's latest public posts",
      }),
    ),
    discoverLatestHint: i18n._(
      msg({
        message: "Draws from your latest public posts.",
        comment: "@context: Description of the Discover Latest option",
      }),
    ),
    discoverFeatured: i18n._(
      msg({
        message: "Featured only",
        comment:
          "@context: Jant Discover option drawing only from featured posts",
      }),
    ),
    discoverFeaturedHint: i18n._(
      msg({
        message: "Draws only from posts you have marked Featured.",
        comment: "@context: Description of the Discover Featured option",
      }),
    ),
    discoverStatusHeading: i18n._(
      msg({
        message: "Where your site stands",
        comment:
          "@context: Heading of the Discover status block on the settings page. Everything under it is the site's own evidence, not an answer fetched from the directory.",
      }),
    ),
    discoverAnnounceRetry: i18n._(
      msg({
        message: "Announce again",
        comment:
          "@context: Button retrying the Discover announcement after it failed",
      }),
    ),
    discoverAnnounceManual: i18n._(
      msg({
        message: "Or submit your address by hand",
        comment:
          "@context: Link to the directory's manual submission form, shown only when the automatic announcement failed",
      }),
    ),
    discoverDemoLocked: i18n._(
      msg({
        message: "Demo sites are never listed in Discover.",
        comment:
          "@context: Help text explaining that Discover is locked off in demo mode",
      }),
    ),
    discoverFeedsOffLocked: i18n._(
      msg({
        message: "Discover reads your Atom feed, so it needs feeds turned on.",
        comment:
          "@context: Help text explaining that Discover cannot work while Atom feeds are disabled",
      }),
    ),
    save: i18n._(
      msg({
        message: "Save",
        comment: "@context: Button to save settings",
      }),
    ),
    cancel: i18n._(
      msg({
        message: "Cancel",
        comment:
          "@context: Button to cancel unsaved changes and revert to original values",
      }),
    ),
    copy: i18n._(
      msg({
        message: "Copy",
        comment: "@context: Button to copy a URL to the clipboard",
      }),
    ),
    copyFailed: i18n._(
      msg({
        message: "Could not copy. Try again.",
        comment:
          "@context: Error toast when copying text to the clipboard fails",
      }),
    ),
    feedUrlCopied: i18n._(
      msg({
        message: "Feed URL copied.",
        comment: "@context: Toast after copying a feed URL to the clipboard",
      }),
    ),
  }).replace(/</g, "\\u003c");

  const timezonesJson = JSON.stringify(
    timezones.map((tz) => ({ value: tz.value, label: tz.label })),
  ).replace(/</g, "\\u003c");

  const aboutPageJson = JSON.stringify(aboutPage).replace(/</g, "\\u003c");

  const initialData = JSON.stringify({
    siteName,
    siteDescription,
    mainRssFeed,
    timeZone,
    siteFooter,
    showJantBrandingOnHome,
    noindex,
    discover,
  }).replace(/</g, "\\u003c");

  // The status sentences carry runtime numbers, so they are translated here
  // rather than handed to the component as templates — values belong with the
  // `i18n._` call that has them. The component renders what it is given.
  const statusLines: string[] = [];

  if (discoverStatus.declaredMode === "none") {
    statusLines.push(
      i18n._(
        msg({
          message: "Your feed says none, so no directory will list this site.",
          comment:
            "@context: Discover status line when the feed declares it does not want to be listed",
        }),
      ),
    );
  } else {
    statusLines.push(
      i18n._(
        msg({
          message: "Your feed says {mode}.",
          comment:
            "@context: Discover status line confirming what the site's Atom feed declares. {mode} is the literal value in the feed, `latest` or `featured`.",
        }),
        { mode: discoverStatus.declaredMode },
      ),
    );

    if (discoverStatus.hasDirectory) {
      statusLines.push(
        discoverStatus.announced === true
          ? i18n._(
              msg({
                message: "Feed address sent to the directory.",
                comment:
                  "@context: Discover status line when the one-off announcement reached the directory",
              }),
            )
          : discoverStatus.announced === false
            ? i18n._(
                msg({
                  message: "The directory could not be reached: {reason}",
                  comment:
                    "@context: Discover status line when the announcement failed. {reason} is the error, such as an HTTP status or a network message.",
                }),
                { reason: discoverStatus.announceError ?? "" },
              )
            : i18n._(
                msg({
                  message:
                    "Not announced yet. Save this section to announce your site.",
                  comment:
                    "@context: Discover status line before the site has ever announced itself",
                }),
              ),
      );
    }

    if (discoverStatus.publicPostCount === 0) {
      statusLines.push(
        i18n._(
          msg({
            message:
              "No public posts yet, so your feed carries nothing to show.",
            comment:
              "@context: Discover status line when the site has nothing public. There is no threshold to state — a directory has nothing to list until the blog publishes something.",
          }),
        ),
      );
    }

    if (
      discoverStatus.declaredMode === "featured" &&
      discoverStatus.publicPostCount > 0 &&
      discoverStatus.featuredPostCount === 0
    ) {
      statusLines.push(
        i18n._(
          msg({
            message:
              "Featured only is selected and no post is marked Featured, so your feed carries nothing to show.",
            comment:
              "@context: Discover status line when the featured-only mode is on but the site has no featured posts",
          }),
        ),
      );
    }

    if (discoverStatus.announced === true) {
      statusLines.push(
        i18n._(
          msg({
            message:
              "A directory reads a newly announced feed within {hours} hours.",
            comment:
              "@context: Discover status line saying how long the first crawl takes",
          }),
          { hours: discoverStatus.firstReadMaxHours },
        ),
      );
    }
  }

  const statusView = {
    lines: statusLines,
    // The manual form is offered only when the automatic path failed. Shown
    // next to a working announcement it would read as a normal route in, which
    // is what made it look like the primary one.
    showRetry:
      discoverStatus.announced === false &&
      discoverStatus.hasDirectory &&
      discoverStatus.declaredMode !== "none",
    submitUrl:
      discoverStatus.announced === false ? discoverStatus.submitUrl : null,
  };

  return (
    <>
      <div class="flex flex-col max-w-form">
        <jant-settings-general
          labels={labels}
          timezones={timezonesJson}
          sitename-fallback={siteNameFallback}
          sitedescription-fallback={siteDescriptionFallback}
          main-feed-url={mainFeedUrl}
          latest-feed-url={latestFeedUrl}
          featured-feed-url={featuredFeedUrl}
          archive-feed-url={archiveFeedUrl}
          feeds-docs-url={FEEDS_DOCS_URL}
          demo-mode={demoMode || undefined}
          discover-docs-url={discoverDocsUrl}
          discover-status={JSON.stringify(statusView)}
          feeds-enabled={rssFeedsEnabled || undefined}
          about-page={aboutPageJson}
          about-edit-url={aboutEditUrl}
          about-create-url={aboutCreateUrl}
        >
          {/* SSR fallback skeleton */}
          <div>
            <h2 class="skel-label" />
            <div class="skel-section-lg" />
          </div>
        </jant-settings-general>
      </div>

      <script
        type="application/json"
        id="settings-initial-data"
        dangerouslySetInnerHTML={{ __html: initialData }}
      />
    </>
  );
}
