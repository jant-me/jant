/**
 * Stats: views by day, the most-viewed posts, and where readers came from.
 *
 * One quiet page of aggregates for the author. It shows a window of days and
 * nothing beyond it — no lifetime total, no comparison with the window before
 * — because a number to beat is the one social mechanic this page must not
 * grow into. `services/stats.ts` has the policy behind the numbers.
 */

import { msg } from "@lingui/core/macro";
import { useLingui } from "../../../i18n/context.js";
import { toPublicPath } from "../../../lib/url.js";
import {
  STATS_WINDOWS,
  VIEW_COUNT_RETENTION_DAYS,
  type StatsOverview,
  type StatsPostDetail,
  type StatsReferrers,
  type StatsSeriesPoint,
  type StatsWindow,
} from "../../../services/stats.js";
import { FormatBadge } from "../FormatBadge.js";

export interface StatsContentProps {
  /** Whether views are being counted; off means no numbers to show. */
  enabled: boolean;
  days: StatsWindow;
  /** The site over the window; `null` when stats are off or a post is shown. */
  overview: StatsOverview | null;
  /** One post over the window, when the page is about one post. */
  post: StatsPostDetail | null;
  sitePathPrefix: string;
  demoMode: boolean;
}

/** The address of the stats page for a window, and optionally one post. */
function statsHref(
  sitePathPrefix: string,
  days: StatsWindow,
  postId?: string,
): string {
  const params = new URLSearchParams();
  if (postId) params.set("post", postId);
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

function WindowSwitch({
  days,
  sitePathPrefix,
  postId,
}: {
  days: StatsWindow;
  sitePathPrefix: string;
  postId?: string;
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
          href={statsHref(sitePathPrefix, window, postId)}
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

function ViewsChart({
  series,
  locale,
}: {
  series: StatsSeriesPoint[];
  locale: string;
}) {
  const { i18n } = useLingui();
  const peak = Math.max(1, ...series.map((point) => point.views));
  const first = series[0];
  const last = series.at(-1);

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
        <figcaption class="settings-stats-axis" aria-hidden="true">
          <span>{formatDayLabel(first.day, locale)}</span>
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
      {rows.length === 0 ? (
        <p class="text-sm text-muted-foreground">
          {i18n._(
            msg({
              message: "Nothing counted yet.",
              comment:
                "@context: Empty state of a list on the stats page when the window has no views",
            }),
          )}
        </p>
      ) : (
        <ol class="settings-stats-list">
          {rows.map((row) => (
            <li key={row.label} class="settings-stats-row">
              <span class="settings-stats-label">{row.label}</span>
              <span class="settings-stats-count">{row.views}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PostList({
  overview,
  days,
  sitePathPrefix,
}: {
  overview: StatsOverview;
  days: StatsWindow;
  sitePathPrefix: string;
}) {
  const { i18n } = useLingui();
  const untitled = i18n._(
    msg({
      message: "Untitled",
      comment:
        "@context: Stand-in title for a post with no title on the stats page",
    }),
  );

  return (
    <section class="settings-stats-section">
      <h2 class="settings-stats-heading">
        {i18n._(
          msg({
            message: "Posts",
            comment:
              "@context: Heading of the most-viewed posts on the stats page",
          }),
        )}
      </h2>
      {overview.posts.length === 0 ? (
        <p class="text-sm text-muted-foreground">
          {i18n._(
            msg({
              message: "Nothing counted yet.",
              comment:
                "@context: Empty state of a list on the stats page when the window has no views",
            }),
          )}
        </p>
      ) : (
        <ol class="settings-stats-list">
          {overview.posts.map((post) => (
            <li key={post.id} class="settings-stats-row">
              <a
                href={statsHref(sitePathPrefix, days, post.id)}
                class="settings-stats-label settings-stats-link"
              >
                {post.title || untitled}
              </a>
              <FormatBadge type={post.format} />
              <span class="settings-stats-count">{post.views}</span>
            </li>
          ))}
        </ol>
      )}
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

export function StatsContent({
  enabled,
  days,
  overview,
  post,
  sitePathPrefix,
  demoMode,
}: StatsContentProps) {
  const { i18n } = useLingui();
  const locale = i18n.locale;
  const untitled = i18n._(
    msg({
      message: "Untitled",
      comment:
        "@context: Stand-in title for a post with no title on the stats page",
    }),
  );
  const shown = post ?? overview;

  return (
    <div class="settings-stats">
      <header class="settings-stats-header">
        {post ? (
          <h1 class="settings-stats-title">
            <a
              href={toPublicPath(`/${post.post.slug}`, sitePathPrefix)}
              class="settings-stats-link"
            >
              {post.post.title || untitled}
            </a>{" "}
            <FormatBadge type={post.post.format} />
          </h1>
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
            postId={post?.post.id}
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
            <p class="settings-stats-total">
              {i18n._(
                msg({
                  message:
                    "{count, plural, one {# view} other {# views}} in the last {days} days",
                  comment:
                    "@context: Total line on the stats page; {days} is 7, 30 or 90",
                }),
                { count: shown.total, days: shown.days },
              )}
            </p>
            <ViewsChart series={shown.series} locale={locale} />
            {overview && (
              <PostList
                overview={overview}
                days={days}
                sitePathPrefix={sitePathPrefix}
              />
            )}
            <ReferrerList referrers={shown.referrers} />
          </>
        )
      )}

      {!post && (
        <Toggle
          enabled={enabled}
          sitePathPrefix={sitePathPrefix}
          demoMode={demoMode}
        />
      )}
    </div>
  );
}
