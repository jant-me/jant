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
import { getJantDocsUrl } from "../../../lib/jant-docs.js";

const FEEDS_DOCS_URL = getJantDocsUrl("feeds");

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
        message: "Search",
        comment:
          "@context: Settings section heading for search engine indexing settings",
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
  }).replace(/</g, "\\u003c");

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
