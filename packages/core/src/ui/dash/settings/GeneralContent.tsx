/**
 * General settings form
 *
 * Server-side template that renders the <jant-settings-general> Lit
 * component: site name, description, and footer; site visibility (search
 * indexing and Jant Discover); feeds; time zone; and home page branding.
 * The settings-bridge.ts script handles server communication.
 */

import { msg } from "@lingui/core/macro";
import { useLingui } from "../../../i18n/context.js";
import type { TimezoneEntry } from "../../../lib/timezones.js";
import type { AboutPageStatus } from "../../../services/about-page.js";
import type {
  DiscoverMode,
  DiscoverPageUrls,
  DiscoverSetting,
} from "../../../lib/discover.js";
import { getJantDocsUrl } from "../../../lib/jant-docs.js";
import { now } from "../../../lib/time.js";
import { getDiscoverCopy } from "./discover-copy.js";

const FEEDS_DOCS_URL = getJantDocsUrl("feeds");

/**
 * Where the site stands in the directory, as far as the site itself can tell.
 *
 * Every field is local evidence. The directory takes no status queries, so
 * nothing here is fetched, and nothing here can say whether a person has
 * moderated the site.
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
  /**
   * A control plane runs this deployment and enrols its blogs itself.
   *
   * The announcement exists because a directory cannot list a site it has
   * never heard of. That is not this site's situation: the platform hosting it
   * registers its whole fleet, so "never announced" is not a defect here and
   * there is nothing for the owner to send. The ping still fires when they
   * switch this back on — a directory reads it as "read me now" and re-polls
   * at once instead of waiting out the backstop — but that is plumbing, not a
   * task, and it is reported nowhere.
   */
  managedByHost: boolean;
  /** The directory's manual submission form, when there is one. */
  submitUrl: string | null;
  /** What this site's feeds actually declare right now. */
  declaredMode: DiscoverMode;
  publicPostCount: number;
  /** Featured thread roots — what a `featured` feed would actually carry. */
  featuredPostCount: number;
  /** The directory's threshold is met. */
  established: boolean;
  minPublicPosts: number;
  firstReadMaxHours: number;
}

/**
 * Whether a directory could still be reading the announcement for the first
 * time.
 *
 * The window is the directory's own backstop: it polls a newly announced feed
 * within `firstReadMaxHours`, so up to that point "sent, nothing visible yet"
 * is the expected state and worth saying. Past it, the site is either listed
 * or it is not, and neither answer comes back here.
 *
 * @param status - The site's Discover status, as assembled by the route
 * @returns `true` while the first read is still due
 * @example
 * ```ts
 * isFirstReadPending({ announceAt: now() - 60, firstReadMaxHours: 6 }); // true
 * ```
 */
function isFirstReadPending(status: {
  announceAt: number | null;
  firstReadMaxHours: number;
}): boolean {
  if (status.announceAt === null) return false;
  return now() < status.announceAt + status.firstReadMaxHours * 3600;
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
  discoverDefault,
  discoverPages,
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
  /**
   * The deployment's own answer, unresolved: `""` when it has none.
   *
   * Not the effective mode. `noindex` is a control on this same page, so
   * folding it in here would hand the browser a value that is already stale by
   * the first click; the component applies it, and the rest of the rules,
   * itself.
   */
  discoverDefault: DiscoverSetting | "";
  /** The directory's own pages, or `null` when none is configured. */
  discoverPages: DiscoverPageUrls | null;
  discoverStatus: DiscoverStatus;
  rssFeedsEnabled: boolean;
  demoMode: boolean;
  timezones: TimezoneEntry[];
  aboutPage: AboutPageStatus;
  aboutEditUrl: string;
  aboutCreateUrl: string;
}) {
  const { i18n } = useLingui();

  // Shared with the setup screen, which asks the same question once.
  const discoverCopy = getDiscoverCopy(i18n);

  const labels = JSON.stringify({
    // The component finds the name and the rules in the help line (and the
    // name in the demo notice that replaces it) to make them links, so it gets
    // them on their own as well as inside the lines.
    discoverName: discoverCopy.name,
    discoverRules: discoverCopy.rules,
    discoverEnabled: discoverCopy.label,
    discoverIntro: discoverCopy.intro,
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
    siteVisibility: i18n._(
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
    discoverSearchOff: i18n._(
      msg({
        message:
          "Search engine indexing is off, so this site is not listed by default. Ticking the box above lists it anyway.",
        comment:
          "@context: Shown under the Jant Discover checkbox when the site has turned search engines away and has never answered Discover itself, which is what unticks the box. Says why the box moved, and that it is still the owner's to tick.",
      }),
    ),
    discoverAnnounce: i18n._(
      msg({
        message: "Announce my site",
        comment:
          "@context: Button sending the Discover announcement, shown when the site has never announced itself or when the announcement failed",
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
        message: "Demo sites are never listed in {name}.",
        comment:
          "@context: Help text under the Jant Discover checkbox explaining that Discover is locked off in demo mode, shown in place of the usual help line. {name} is the directory's name and is rendered as the link to it, so keep it as one run of text.",
      }),
      { name: discoverCopy.name },
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
  //
  // Only what the controls above cannot say for themselves gets a line. The
  // ticked box and the picked mode already state that the site is listed and
  // what its feed declares, and a site past the directory's threshold has
  // nothing to do about being past it — printing either turns this into a
  // report that is read once and skipped forever after. What is left is a
  // problem, a task, or an answer that is still outstanding.
  const statusLines: string[] = [];

  // A site that is not listed gets no status block at all: every line under
  // it would only restate the unticked checkbox above.
  if (discoverStatus.declaredMode !== "none") {
    if (discoverStatus.hasDirectory && !discoverStatus.managedByHost) {
      if (discoverStatus.announced === false) {
        statusLines.push(
          i18n._(
            msg({
              message: "The directory could not be reached: {reason}",
              comment:
                "@context: Discover status line when the announcement failed. {reason} is the error, such as an HTTP status or a network message.",
            }),
            { reason: discoverStatus.announceError ?? "" },
          ),
        );
      } else if (discoverStatus.announced === null) {
        statusLines.push(
          i18n._(
            msg({
              message:
                "Not announced yet. No directory has been told this site exists.",
              comment:
                "@context: Discover status line before the site has ever announced itself. The button under the lines is how it is sent.",
            }),
          ),
        );
      } else if (isFirstReadPending(discoverStatus)) {
        // A successful announcement is worth confirming only while its answer
        // is still outstanding. Inside the first-read window the owner is
        // waiting for a directory to come round; after it, the directory
        // either lists the site — which the directory itself shows — or has
        // declined to, and this page can see neither.
        statusLines.push(
          i18n._(
            msg({
              message:
                "Feed address sent. A directory reads a newly announced feed within {hours} hours.",
              comment:
                "@context: Discover status line right after a successful announcement, while the first crawl is still due",
            }),
            { hours: discoverStatus.firstReadMaxHours },
          ),
        );
      }
    }

    // A site that stored `featured` under an older release: the directory
    // reads only its featured feed, on every list. The box still reads as on,
    // and only the owner ticking it again widens what the directory may show.
    if (
      discoverStatus.declaredMode === "featured" &&
      discoverStatus.publicPostCount > 0 &&
      discoverStatus.featuredPostCount === 0
    ) {
      statusLines.push(
        i18n._(
          msg({
            message:
              "This site still limits Discover to featured posts, and no post is marked Featured, so your feed carries nothing to show. Untick and tick the box to let Discover read every public post.",
            comment:
              "@context: Discover status line for a site that chose the old featured-only mode and has no featured posts. Says how to move to the current setting, which reads every public post.",
          }),
        ),
      );
    }

    if (!discoverStatus.established) {
      statusLines.push(
        i18n._(
          msg({
            message:
              "Nothing published yet. jant.me lists a blog once it has {minCount, plural, one {one public post} other {# public posts}}.",
            comment:
              "@context: Discover status line when the site does not meet the directory's threshold yet. Stated as jant.me's rule, because a directory of your own may decide differently.",
          }),
          { minCount: discoverStatus.minPublicPosts },
        ),
      );
    }
  }

  const statusView = {
    lines: statusLines,
    // The button covers both halves of "the directory has not heard from us":
    // an announcement that failed, and one that was never made — a site whose
    // mode came from the deployment default has nothing else to send it with.
    // The manual form, by contrast, is offered only when the automatic path
    // failed. Shown next to a working announcement it would read as a normal
    // route in, which is what made it look like the primary one.
    showAnnounce:
      discoverStatus.announced !== true &&
      discoverStatus.hasDirectory &&
      !discoverStatus.managedByHost &&
      discoverStatus.declaredMode !== "none",
    submitUrl:
      discoverStatus.announced === false && !discoverStatus.managedByHost
        ? discoverStatus.submitUrl
        : null,
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
          discover-default={discoverDefault}
          discover-pages={
            discoverPages ? JSON.stringify(discoverPages) : undefined
          }
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
