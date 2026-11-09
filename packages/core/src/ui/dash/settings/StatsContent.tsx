/**
 * Stats: views by day, the most-viewed pages, and where readers came from.
 *
 * One quiet page of aggregates for the author. It shows a window of days and
 * nothing beyond it — no lifetime total, no comparison with the window before
 * — because a number to beat is the one social mechanic this page must not
 * grow into. When counting began inside the window, the page says so and the
 * chart starts on that day: the days before were not counted, which is not
 * the same as a month of zeros. Posts, collections and the site's own pages
 * share one list, since the question is what was read, not what kind of
 * thing it was; a badge says the kind. `services/stats.ts` has the policy
 * behind the numbers.
 */

import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "../../../i18n/context.js";
import { toPublicPath } from "../../../lib/url.js";
import {
  STATS_WINDOWS,
  VIEW_COUNT_RETENTION_DAYS,
  type StatsOverview,
  type StatsPage,
  type StatsPageDetail,
  type StatsPageRow,
  type StatsReferrers,
  type StatsSeriesPoint,
  type StatsWindow,
} from "../../../services/stats.js";
import { FormatBadge } from "../FormatBadge.js";

export interface StatsContentProps {
  /** Whether views are being counted; off means no numbers to show. */
  enabled: boolean;
  days: StatsWindow;
  /** The site over the window; `null` when stats are off or one page is shown. */
  overview: StatsOverview | null;
  /** One page over the window, when the page is about one page. */
  page: StatsPageDetail | null;
  sitePathPrefix: string;
  demoMode: boolean;
}

/** The address of the stats page for a window, and optionally one page. */
function statsHref(
  sitePathPrefix: string,
  days: StatsWindow,
  pageKey?: string,
): string {
  const params = new URLSearchParams();
  if (pageKey) params.set("page", pageKey);
  params.set("days", String(days));
  return `${toPublicPath("/settings/stats", sitePathPrefix)}?${params}`;
}

/** `Nov 8` for a day key, in the dashboard's locale. */
function formatDayLabel(day: string, locale: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1)));
}

/** The site's own pages by name; any other path as itself. */
function pathName(path: string, i18n: I18n): string {
  switch (path) {
    case "/":
      return i18n._(
        msg({
          message: "Home",
          comment:
            "@context: Row for the home page in the pages list on the stats page",
        }),
      );
    case "/archive":
      return i18n._(
        msg({
          message: "Archive",
          comment:
            "@context: Row for the archive page in the pages list on the stats page",
        }),
      );
    case "/collections":
      return i18n._(
        msg({
          message: "Collections",
          comment:
            "@context: Row for the collections directory in the pages list on the stats page",
        }),
      );
    case "/featured":
      return i18n._(
        msg({
          message: "Featured",
          comment:
            "@context: Row for the Featured page in the pages list on the stats page",
        }),
      );
    case "/subscribe":
      return i18n._(
        msg({
          message: "Subscribe",
          comment:
            "@context: Row for the subscribe page in the pages list on the stats page",
        }),
      );
    default:
      return path;
  }
}

/**
 * What a page is called on the stats page: a post by the name the rest of
 * Jant gives it, or its address when nothing gives one; a collection by its
 * title; the site's own pages by name; any other path as itself. A deleted
 * post or collection is said to be one.
 *
 * @param page - The page
 * @param i18n - The dashboard's locale
 * @returns The name
 * @example
 * statsPageName({ kind: "path", key: "/" }, i18n); // "Home"
 */
export function statsPageName(page: StatsPage, i18n: I18n): string {
  switch (page.kind) {
    case "post":
      if (!page.post) {
        return i18n._(
          msg({
            message: "Deleted post",
            comment:
              "@context: Name on the stats page of a post whose views remain after it was deleted",
          }),
        );
      }
      return page.post.title || page.post.slug;
    case "collection":
      if (!page.collection) {
        return i18n._(
          msg({
            message: "Deleted collection",
            comment:
              "@context: Name on the stats page of a collection whose views remain after it was deleted",
          }),
        );
      }
      return page.collection.title;
    case "path":
      return pathName(page.key, i18n);
  }
}

/** The public address of a page, while it still has one. */
function pagePublicPath(page: StatsPage): string | null {
  switch (page.kind) {
    case "post":
      return page.post ? `/${page.post.slug}` : null;
    case "collection":
      return page.collection ? `/${page.collection.slug}` : null;
    case "path":
      return page.key;
  }
}

/** The kind of a page, where the name alone does not say: a post's format, or that it is a collection. */
function PageBadge({ page }: { page: StatsPage }) {
  const { i18n } = useLingui();
  if (page.kind === "post" && page.post) {
    return <FormatBadge type={page.post.format} />;
  }
  if (page.kind === "collection") {
    return (
      <span class="badge-outline">
        {i18n._(
          msg({
            message: "Collection",
            comment: "@context: Badge on a collection's row on the stats page",
          }),
        )}
      </span>
    );
  }
  return null;
}

function WindowSwitch({
  days,
  sitePathPrefix,
  pageKey,
}: {
  days: StatsWindow;
  sitePathPrefix: string;
  pageKey?: string;
}) {
  const { i18n } = useLingui();
  return (
    <nav
      class="settings-stats-windows"
      aria-label={i18n._(
        msg({
          message: "Window",
          comment:
            "@context: Accessible name of the 7/30/90-day switch on the stats page",
        }),
      )}
    >
      {STATS_WINDOWS.map((window) => (
        <a
          key={window}
          href={statsHref(sitePathPrefix, window, pageKey)}
          class="settings-stats-window"
          aria-current={window === days ? "page" : undefined}
        >
          {i18n._(
            msg({
              message: "{window} days",
              comment:
                "@context: One option of the window switch on the stats page; {window} is 7, 30 or 90",
            }),
            { window },
          )}
        </a>
      ))}
    </nav>
  );
}

/**
 * One bar per counted day over the whole window, so a bar is the same width
 * whenever the record began. The days before the record have no bar and no
 * baseline: the baseline starts where counting did. The total line has then
 * already named that day, so the axis carries today's date alone; it names
 * both ends only when every day of the window was counted.
 */
function ViewsChart({
  series,
  start,
  locale,
}: {
  series: StatsSeriesPoint[];
  start: string | null;
  locale: string;
}) {
  const { i18n } = useLingui();
  const peak = Math.max(1, ...series.map((point) => point.views));
  const startIndex = start
    ? Math.max(
        0,
        series.findIndex((point) => point.day === start),
      )
    : 0;
  const first = series[startIndex];
  const last = series.at(-1);
  const single = start !== null;

  return (
    <figure class="settings-stats-figure">
      <svg
        class="settings-stats-chart"
        viewBox={`0 0 ${series.length} 100`}
        preserveAspectRatio="none"
        role="img"
        aria-label={i18n._(
          msg({
            message: "Views per day",
            comment:
              "@context: Accessible name of the bar chart on the stats page",
          }),
        )}
      >
        {series.map((point, index) => {
          if (index < startIndex) return null;
          const height = (point.views / peak) * 100;
          return (
            <rect
              key={point.day}
              class="settings-stats-bar"
              x={index + 0.15}
              y={100 - height}
              width={0.7}
              height={height}
            >
              <title>
                {i18n._(
                  msg({
                    message:
                      "{day}: {count, plural, one {# view} other {# views}}",
                    comment:
                      "@context: Tooltip on one bar of the stats chart; {day} is a date like Nov 8",
                  }),
                  {
                    day: formatDayLabel(point.day, locale),
                    count: point.views,
                  },
                )}
              </title>
            </rect>
          );
        })}
      </svg>
      {first && last && (
        <figcaption
          class={`settings-stats-axis${single ? " settings-stats-axis-single" : ""}`}
          style={`--stats-start:${(startIndex / series.length) * 100}%`}
          aria-hidden="true"
        >
          {!single && <span>{formatDayLabel(first.day, locale)}</span>}
          <span>{formatDayLabel(last.day, locale)}</span>
        </figcaption>
      )}
    </figure>
  );
}

function ReferrerList({ referrers }: { referrers: StatsReferrers }) {
  const { i18n } = useLingui();
  const rows = [
    ...referrers.top.map((row) => ({ label: row.host, views: row.views })),
    {
      label: i18n._(
        msg({
          message: "Direct",
          comment:
            "@context: Row on the stats page for views with no referrer: typed addresses, apps, feed readers",
        }),
      ),
      views: referrers.direct,
    },
    {
      label: i18n._(
        msg({
          message: "Other",
          comment:
            "@context: Row on the stats page for every referrer past the ten listed",
        }),
      ),
      views: referrers.other,
    },
  ].filter((row) => row.views > 0);

  return (
    <section class="settings-stats-section">
      <h2 class="settings-stats-heading">
        {i18n._(
          msg({
            message: "Referrers",
            comment: "@context: Heading of the referrer list on the stats page",
          }),
        )}
      </h2>
      <ol class="settings-stats-list">
        {rows.map((row) => (
          <li key={row.label} class="settings-stats-row">
            <span class="settings-stats-label">{row.label}</span>
            <span class="settings-stats-count">{row.views}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The most-viewed pages of the window, each a link to its own numbers. */
function PageList({
  pages,
  days,
  sitePathPrefix,
}: {
  pages: StatsPageRow[];
  days: StatsWindow;
  sitePathPrefix: string;
}) {
  const { i18n } = useLingui();

  return (
    <section class="settings-stats-section">
      <h2 class="settings-stats-heading">
        {i18n._(
          msg({
            message: "Pages",
            comment:
              "@context: Heading of the most-viewed pages on the stats page",
          }),
        )}
      </h2>
      <ol class="settings-stats-list">
        {pages.map((row) => (
          <li key={row.key} class="settings-stats-row">
            <a
              href={statsHref(sitePathPrefix, days, row.key)}
              class="settings-stats-label settings-stats-link"
            >
              {statsPageName(row, i18n)}
            </a>
            <PageBadge page={row} />
            <span class="settings-stats-count">{row.views}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Toggle({
  enabled,
  sitePathPrefix,
  demoMode,
}: {
  enabled: boolean;
  sitePathPrefix: string;
  demoMode: boolean;
}) {
  const { i18n } = useLingui();
  const endpoint = toPublicPath("/settings/stats", sitePathPrefix);
  const confirmOptions = JSON.stringify({
    message: i18n._(
      msg({
        message: "Turn off stats and delete every count? This can't be undone.",
        comment:
          "@context: Confirmation before turning off stats, which deletes the counts",
      }),
    ),
    confirmLabel: i18n._(
      msg({
        message: "Turn Off",
        comment: "@context: Confirm button for turning off stats",
      }),
    ),
    cancelLabel: i18n._(
      msg({
        message: "Cancel",
        comment: "@context: Cancel button in the confirm dialog",
      }),
    ),
    tone: "danger",
  });
  // Turning on saves at once. Turning off asks first, since it deletes; a
  // cancelled dialog puts the box back.
  const onChange = `(async () => { if ($enabled) { @post('${endpoint}'); return; } if (await jantConfirm(${confirmOptions})) { @post('${endpoint}') } else { $enabled = true } })()`;

  return (
    <section
      class="settings-stats-section"
      data-signals={JSON.stringify({ enabled })}
    >
      <label class="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          class="checkbox"
          checked={enabled}
          disabled={demoMode}
          data-bind="enabled"
          data-on:change={onChange}
        />
        <span>
          {i18n._(
            msg({
              message: "Count page views",
              comment: "@context: Checkbox label on the stats page",
            }),
          )}
        </span>
      </label>
      <p class="text-sm text-muted-foreground">
        {demoMode
          ? i18n._(
              msg({
                message: "Stats settings are locked in demo mode.",
                comment:
                  "@context: Note under the stats checkbox when demo restrictions apply",
              }),
            )
          : i18n._(
              msg({
                message:
                  "Counts are kept for {days} days and store nothing about any reader. Turning this off deletes them.",
                comment:
                  "@context: Help text under the stats checkbox; {days} is the retention window",
              }),
              { days: VIEW_COUNT_RETENTION_DAYS },
            )}
      </p>
    </section>
  );
}

/**
 * The total line. While the record began inside the window it names the
 * day, since "the last 30 days" would claim days that were never counted.
 */
function TotalLine({
  shown,
  locale,
}: {
  shown: StatsOverview | StatsPageDetail;
  locale: string;
}) {
  const { i18n } = useLingui();
  return (
    <p class="settings-stats-total">
      {shown.start
        ? i18n._(
            msg({
              message:
                "{count, plural, one {# view} other {# views}} since {date}",
              comment:
                "@context: Total line on the stats page while counting began inside the window; {date} is a day like Nov 9",
            }),
            { count: shown.total, date: formatDayLabel(shown.start, locale) },
          )
        : i18n._(
            msg({
              message:
                "{count, plural, one {# view} other {# views}} in the last {days} days",
              comment:
                "@context: Total line on the stats page; {days} is 7, 30 or 90",
            }),
            { count: shown.total, days: shown.days },
          )}
    </p>
  );
}

/** The heading of one page's numbers: its name, linked to it while it exists, and its kind. */
function PageHeading({
  page,
  sitePathPrefix,
}: {
  page: StatsPage;
  sitePathPrefix: string;
}) {
  const { i18n } = useLingui();
  const name = statsPageName(page, i18n);
  const path = pagePublicPath(page);
  return (
    <h1 class="settings-stats-title">
      {path ? (
        <a
          href={toPublicPath(path, sitePathPrefix)}
          class="settings-stats-link"
        >
          {name}
        </a>
      ) : (
        name
      )}{" "}
      <PageBadge page={page} />
    </h1>
  );
}

export function StatsContent({
  enabled,
  days,
  overview,
  page,
  sitePathPrefix,
  demoMode,
}: StatsContentProps) {
  const { i18n } = useLingui();
  const locale = i18n.locale;
  const shown = page ?? overview;

  return (
    <div class="settings-stats">
      <header class="settings-stats-header">
        {page ? (
          <PageHeading page={page.page} sitePathPrefix={sitePathPrefix} />
        ) : (
          <h1 class="settings-stats-title">
            {i18n._(
              msg({
                message: "Stats",
                comment: "@context: Stats page title",
              }),
            )}
          </h1>
        )}
        {enabled && (
          <WindowSwitch
            days={days}
            sitePathPrefix={sitePathPrefix}
            pageKey={page?.page.key}
          />
        )}
      </header>

      {!enabled ? (
        <p class="text-sm text-muted-foreground">
          {i18n._(
            msg({
              message: "Stats are off. Turn them on below to start counting.",
              comment: "@context: Stats page body when counting is turned off",
            }),
          )}
        </p>
      ) : (
        shown && (
          <>
            <TotalLine shown={shown} locale={locale} />
            <ViewsChart
              series={shown.series}
              start={shown.start}
              locale={locale}
            />
            {/* The total line has already said there is nothing to list. */}
            {shown.total > 0 && overview && (
              <PageList
                pages={overview.pages}
                days={days}
                sitePathPrefix={sitePathPrefix}
              />
            )}
            {shown.total > 0 && <ReferrerList referrers={shown.referrers} />}
          </>
        )
      )}

      {!page && (
        <Toggle
          enabled={enabled}
          sitePathPrefix={sitePathPrefix}
          demoMode={demoMode}
        />
      )}
    </div>
  );
}
