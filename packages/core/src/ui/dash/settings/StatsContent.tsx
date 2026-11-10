/**
 * Stats: views by hour or by day, the most-viewed pages, and where readers
 * came from.
 *
 * One quiet page of aggregates for the author. It shows a window of time and
 * nothing beyond it — no lifetime total, no comparison with the window before
 * — because a number to beat is the one social mechanic this page must not
 * grow into. Today is the default and is drawn by the hour; a longer window
 * by the day. When counting began inside the window, the page says so and the
 * chart starts on that day: the days before were not counted, which is not
 * the same as a month of zeros. Posts, collections and the site's own pages
 * share one ranked list, since the question is what was read, not what kind
 * of thing it was; a badge says the kind, and a bar behind each row says its
 * share. Every page and every referrer in the lists opens on its own: a
 * page with where its readers came from, a referrer with the pages it sent
 * them to. Each hop drops the other dimension rather than stacking filters,
 * since today's hours are kept for the site as a whole and a filtered chart
 * would have nothing to draw. `services/stats.ts` has the policy behind the
 * numbers.
 */

import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "../../../i18n/context.js";
import { toPublicPath } from "../../../lib/url.js";
import { VIEW_INTERNAL_REFERRER } from "../../../lib/view-counting.js";
import {
  STATS_WINDOWS,
  VIEW_COUNT_RETENTION_DAYS,
  type StatsOverview,
  type StatsPage,
  type StatsPageDetail,
  type StatsPageRow,
  type StatsReferrerDetail,
  type StatsReferrers,
  type StatsSeries,
  type StatsWindow,
} from "../../../services/stats.js";
import { FormatBadge } from "../FormatBadge.js";

export interface StatsContentProps {
  /** Whether views are being counted; off means no numbers to show. */
  enabled: boolean;
  days: StatsWindow;
  /** The site over the window; `null` when stats are off or a detail is shown. */
  overview: StatsOverview | null;
  /** One page over the window, when the page is about one page. */
  page: StatsPageDetail | null;
  /** One referrer over the window, when the page is about one referrer. */
  referrer: StatsReferrerDetail | null;
  sitePathPrefix: string;
  demoMode: boolean;
}

/** What a stats address can be about besides the site: one page, or one referrer. */
type StatsTarget = { page: string } | { referrer: string };

/**
 * The address of the stats page for a window, and optionally one page or
 * one referrer. A referrer key goes in verbatim, so Direct is `referrer=`
 * and Internal `referrer=%2F`: these addresses live in the settings and
 * are never shown.
 */
function statsHref(
  sitePathPrefix: string,
  days: StatsWindow,
  target?: StatsTarget,
): string {
  const params = new URLSearchParams();
  if (target && "page" in target) params.set("page", target.page);
  if (target && "referrer" in target) params.set("referrer", target.referrer);
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

/** `14:00` for an hour of the day, in the dashboard's locale. */
function formatHourLabel(hour: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, 0, 1, hour)));
}

/** The hour of the day an hour key names. */
function hourOf(hourKey: string): number {
  return Number(hourKey.slice(11, 13));
}

/** What one point of a series is called under the chart and in a hovered bar's label. */
function pointLabel(series: StatsSeries, at: string, locale: string): string {
  return series.unit === "hour"
    ? formatHourLabel(hourOf(at), locale)
    : formatDayLabel(at, locale);
}

/** The share of a total one row holds, as a CSS percentage for its bar. */
function shareOf(views: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((views / total) * 1000) / 10}%`;
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

/**
 * What a referrer is called on the stats page: a host or a tag as itself,
 * the two keys that are not hosts by name.
 *
 * @param key - The referrer's counter key
 * @param i18n - The dashboard's locale
 * @returns The name
 * @example
 * statsReferrerName("", i18n); // "Direct"
 */
export function statsReferrerName(key: string, i18n: I18n): string {
  if (key === "") {
    return i18n._(
      msg({
        message: "Direct",
        comment:
          "@context: Name on the stats page of the views with no referrer: typed addresses, apps, feed readers; a row of the referrer list and the heading of their own numbers",
      }),
    );
  }
  if (key === VIEW_INTERNAL_REFERRER) {
    return i18n._(
      msg({
        message: "Internal",
        comment:
          "@context: Name on the stats page of the views that followed a link from another page of the site; a row of the referrer list and the heading of their own numbers",
      }),
    );
  }
  return key;
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

/** The translator the components get from the context; it takes values. */
type Translator = ReturnType<typeof useLingui>["i18n"];

/** What a window is called on the switch. */
function windowLabel(window: StatsWindow, i18n: Translator): string {
  if (window === 1) {
    return i18n._(
      msg({
        message: "Today",
        comment:
          "@context: The one-day option of the window switch on the stats page",
      }),
    );
  }
  return i18n._(
    msg({
      message: "{window} days",
      comment:
        "@context: One option of the window switch on the stats page; {window} is 7 or 30",
    }),
    { window },
  );
}

function WindowSwitch({
  days,
  sitePathPrefix,
  target,
}: {
  days: StatsWindow;
  sitePathPrefix: string;
  target?: StatsTarget;
}) {
  const { i18n } = useLingui();
  return (
    <nav
      class="settings-stats-windows"
      aria-label={i18n._(
        msg({
          message: "Window",
          comment:
            "@context: Accessible name of the today/7/30-day switch on the stats page",
        }),
      )}
    >
      {STATS_WINDOWS.map((window) => (
        <a
          key={window}
          href={statsHref(sitePathPrefix, window, target)}
          class="settings-stats-window"
          aria-current={window === days ? "page" : undefined}
        >
          {windowLabel(window, i18n)}
        </a>
      ))}
    </nav>
  );
}

/**
 * One slot per point over the whole window, so a bar is the same width
 * whatever the record covers. Today has 24 slots and bars up to the current
 * hour. A longer window has one slot per day; the days before the record
 * have no bar and no baseline, since the baseline starts where counting did.
 * The total line has then already named that day, so the axis carries
 * today's date alone; it names both ends only when every day was counted.
 * A slot names its point and count in `data-label`, which the stylesheet
 * shows above the bar while the slot is hovered: the whole column answers,
 * so a short bar is as easy to read as a tall one.
 */
function ViewsChart({
  series,
  start,
  locale,
}: {
  series: StatsSeries;
  start: string | null;
  locale: string;
}) {
  const { i18n } = useLingui();
  const { unit, points } = series;
  const slots = unit === "hour" ? 24 : points.length;
  const peak = Math.max(1, ...points.map((point) => point.views));
  const startIndex =
    unit === "day" && start
      ? Math.max(
          0,
          points.findIndex((point) => point.at === start),
        )
      : 0;
  const single = unit === "day" && start !== null;
  const firstLabel =
    unit === "hour"
      ? formatHourLabel(0, locale)
      : points[startIndex] && formatDayLabel(points[startIndex].at, locale);
  const last = points.at(-1);
  const lastLabel =
    unit === "hour"
      ? formatHourLabel(23, locale)
      : last && formatDayLabel(last.at, locale);

  return (
    <figure class="settings-stats-figure">
      <div
        class="settings-stats-chart"
        role="img"
        aria-label={
          unit === "hour"
            ? i18n._(
                msg({
                  message: "Views per hour",
                  comment:
                    "@context: Accessible name of today's bar chart on the stats page",
                }),
              )
            : i18n._(
                msg({
                  message: "Views per day",
                  comment:
                    "@context: Accessible name of the bar chart on the stats page",
                }),
              )
        }
      >
        {Array.from({ length: slots }, (_, index) => {
          const point = points[index];
          if (!point || index < startIndex) {
            return <span key={`slot-${index}`} class="settings-stats-slot" />;
          }
          const height = (point.views / peak) * 100;
          return (
            <span
              key={point.at}
              class="settings-stats-slot"
              style={`--stats-height:${height}%`}
              data-label={i18n._(
                msg({
                  message:
                    "{day}: {count, plural, one {# view} other {# views}}",
                  comment:
                    "@context: Tooltip on one bar of the stats chart; {day} is a date like Nov 8 or an hour like 14:00",
                }),
                {
                  day: pointLabel(series, point.at, locale),
                  count: point.views,
                },
              )}
            >
              <span class="settings-stats-bar" />
            </span>
          );
        })}
      </div>
      {firstLabel && lastLabel && (
        <figcaption
          class={`settings-stats-axis${single ? " settings-stats-axis-single" : ""}`}
          style={`--stats-start:${(startIndex / slots) * 100}%`}
          aria-hidden="true"
        >
          {!single && <span>{firstLabel}</span>}
          <span>{lastLabel}</span>
        </figcaption>
      )}
    </figure>
  );
}

/** One ranked row: its place, its name, its kind, its count, and a bar for its share. */
function RankedRow({
  rank,
  share,
  views,
  children,
}: {
  rank: number;
  share: string;
  views: number;
  children: unknown;
}) {
  return (
    <li class="settings-stats-row" style={`--stats-share:${share}`}>
      <span class="settings-stats-rank">{rank}</span>
      {children}
      <span class="settings-stats-count">{views}</span>
    </li>
  );
}

/**
 * Where the views came from, each referrer a link to the pages it sent
 * readers to. Internal and Direct take their place among the hosts by
 * size; Other is last and opens nothing, being a remainder.
 */
function ReferrerList({
  referrers,
  total,
  days,
  sitePathPrefix,
}: {
  referrers: StatsReferrers;
  total: number;
  days: StatsWindow;
  sitePathPrefix: string;
}) {
  const { i18n } = useLingui();
  const rows: { key: string | null; label: string; views: number }[] = [
    ...referrers.top.map((row) => ({
      key: row.host,
      label: row.host,
      views: row.views,
    })),
    {
      key: VIEW_INTERNAL_REFERRER,
      label: statsReferrerName(VIEW_INTERNAL_REFERRER, i18n),
      views: referrers.internal,
    },
    { key: "", label: statsReferrerName("", i18n), views: referrers.direct },
  ]
    .filter((row) => row.views > 0)
    .sort((a, b) => b.views - a.views);
  if (referrers.other > 0) {
    rows.push({
      key: null,
      label: i18n._(
        msg({
          message: "Other",
          comment:
            "@context: Row on the stats page for every referrer past the ten listed",
        }),
      ),
      views: referrers.other,
    });
  }

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
        {rows.map((row, index) => (
          <RankedRow
            key={row.label}
            rank={index + 1}
            share={shareOf(row.views, total)}
            views={row.views}
          >
            {row.key === null ? (
              <span class="settings-stats-label">{row.label}</span>
            ) : (
              <a
                href={statsHref(sitePathPrefix, days, { referrer: row.key })}
                class="settings-stats-label settings-stats-link"
              >
                {row.label}
              </a>
            )}
          </RankedRow>
        ))}
      </ol>
    </section>
  );
}

/** The most-viewed pages of the window, each a link to its own numbers. */
function PageList({
  pages,
  total,
  days,
  sitePathPrefix,
}: {
  pages: StatsPageRow[];
  total: number;
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
        {pages.map((row, index) => (
          <RankedRow
            key={row.key}
            rank={index + 1}
            share={shareOf(row.views, total)}
            views={row.views}
          >
            <a
              href={statsHref(sitePathPrefix, days, { page: row.key })}
              class="settings-stats-label settings-stats-link"
            >
              {statsPageName(row, i18n)}
            </a>
            <PageBadge page={row} />
          </RankedRow>
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
 * The total line. Today says so. While the record began inside a longer
 * window it names the day, since "the last 30 days" would claim days that
 * were never counted.
 */
function TotalLine({
  shown,
  locale,
}: {
  shown: Pick<StatsOverview, "days" | "total" | "start">;
  locale: string;
}) {
  const { i18n } = useLingui();
  if (shown.days === 1) {
    return (
      <p class="settings-stats-total">
        {i18n._(
          msg({
            message: "{count, plural, one {# view} other {# views}} today",
            comment: "@context: Total line on the stats page for today",
          }),
          { count: shown.total },
        )}
      </p>
    );
  }
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
                "@context: Total line on the stats page; {days} is 7 or 30",
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
          class="settings-stats-title-name settings-stats-link"
        >
          {name}
        </a>
      ) : (
        <span class="settings-stats-title-name">{name}</span>
      )}
      <PageBadge page={page} />
    </h1>
  );
}

/** The heading of one referrer's numbers: its name, as the list wrote it. */
function ReferrerHeading({ referrer }: { referrer: string }) {
  const { i18n } = useLingui();
  return (
    <h1 class="settings-stats-title">
      <span class="settings-stats-title-name">
        {statsReferrerName(referrer, i18n)}
      </span>
    </h1>
  );
}

export function StatsContent({
  enabled,
  days,
  overview,
  page,
  referrer,
  sitePathPrefix,
  demoMode,
}: StatsContentProps) {
  const { i18n } = useLingui();
  const locale = i18n.locale;
  const shown = page ?? referrer ?? overview;
  // The site and a referrer list pages; the site and a page list referrers.
  const pages = overview?.pages ?? referrer?.pages ?? null;
  const referrers = overview?.referrers ?? page?.referrers ?? null;
  const target: StatsTarget | undefined = page
    ? { page: page.page.key }
    : referrer
      ? { referrer: referrer.referrer }
      : undefined;

  return (
    <div class="settings-stats">
      <header class="settings-stats-header">
        {page ? (
          <PageHeading page={page.page} sitePathPrefix={sitePathPrefix} />
        ) : referrer ? (
          <ReferrerHeading referrer={referrer.referrer} />
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
            target={target}
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
            {shown.series && (
              <ViewsChart
                series={shown.series}
                start={shown.start}
                locale={locale}
              />
            )}
            {/* The total line has already said there is nothing to list. */}
            {shown.total > 0 && pages && (
              <PageList
                pages={pages}
                total={shown.total}
                days={days}
                sitePathPrefix={sitePathPrefix}
              />
            )}
            {shown.total > 0 && referrers && (
              <ReferrerList
                referrers={referrers}
                total={shown.total}
                days={days}
                sitePathPrefix={sitePathPrefix}
              />
            )}
          </>
        )
      )}

      {!target && (
        <Toggle
          enabled={enabled}
          sitePathPrefix={sitePathPrefix}
          demoMode={demoMode}
        />
      )}
    </div>
  );
}
