/**
 * View stats: what is kept, how it is written, and what the Stats page reads.
 *
 * Jant counts page views so an author can see, on one quiet page, which days
 * and which pages were read and where readers came from — and nothing else.
 * No reader is identified: there are no uniques, no countries, no devices,
 * and no record of any visit. What exists is one counter per site, day, page
 * and referring host (`view_count`), and this file is the whole policy for
 * that table.
 *
 * - **A row is a counter.** Ten thousand readers opening one post from one
 *   link are one row. The table grows with the variety of a day's traffic,
 *   never its volume.
 * - **A key names a page.** A post, a collection or a smart collection is
 *   counted by id, so its count survives a change of address; the home page,
 *   the archive and an aggregate selection are counted by path. The key's
 *   shape says which (`viewPageKind`), and the list is named from it when
 *   read, never stored.
 * - **Thirty days.** Rows older than `VIEW_COUNT_RETENTION_DAYS` are deleted,
 *   once a day per site, by whichever flush comes first. Nothing is rolled up:
 *   a lifetime total is exactly the scoreboard this feature is not.
 * - **Hours for today alone.** `view_hour` keeps one total per site and hour,
 *   no page and no referrer, so today's chart can show when readers came;
 *   today's lists still come from the day table. Two days of hours are kept.
 * - **Where a reader came from, in three kinds.** A host or a tag, the site
 *   itself (`VIEW_INTERNAL_REFERRER`: a reader moving from one page to the
 *   next), or nothing at all: a typed address, a bookmark, an app, a feed
 *   reader. Direct means the last of these only.
 * - **Bounded breakdown.** A site-day holds at most
 *   `VIEW_COUNT_ROWS_PER_SITE_DAY` rows; past that, new page-referrer pairs
 *   land on one overflow row, so a script spraying made-up referrers cannot
 *   grow the table. Totals stay exact, the breakdown stops.
 * - **Bounded writes.** On Cloudflare, free-tier D1 allows 100,000 rows
 *   written per UTC day and refuses every query once that is spent, so a
 *   well-read day must never be able to take the site down. Writes arrive in
 *   batches from `lib/view-buffer.ts`, and once a day's recorded views reach
 *   the instance's `STATS_DAILY_LIMIT` the buffer stops until the next day.
 * - **A record with a start.** The day counting began is kept in the
 *   `STATS_SINCE` setting, written by whichever comes first: the switch
 *   being turned on, the first look at the page, or the first flush of the
 *   site's counts. The page says "since Nov 9" and draws nothing for the
 *   days before, instead of showing a launch week as a month of zeros.
 *   Turning stats off deletes it with the counts.
 *
 * `record()` is the one write path. It takes entries for any site, because a
 * batch holds whatever the process saw in its last few seconds; the reads are
 * scoped to the service's site like every other service.
 */

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import { supportsDrizzleTransaction, type Database } from "../db/index.js";
import type { DatabaseDialect } from "../db/dialect.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { getPostDisplayTitle } from "../lib/post-meta.js";
import { now } from "../lib/time.js";
import type { ViewCountEntry, ViewRecordResult } from "../lib/view-buffer.js";
import {
  dayKeysEndingAt,
  hourKeysOfDay,
  isDayKey,
  shiftDayKey,
  VIEW_INTERNAL_REFERRER,
  VIEW_OVERFLOW_KEY,
  viewPageKind,
} from "../lib/view-counting.js";
import type { Format } from "../types/constants.js";
import type { SettingsService } from "./settings.js";

/** Days a counter row is kept before the sweep deletes it. */
export const VIEW_COUNT_RETENTION_DAYS = 30;

/** Days an hour row is kept: today, and yesterday until today's sweep. */
export const VIEW_HOUR_RETENTION_DAYS = 2;

/** Rows one site may hold for one day before new pairs fold into overflow. */
export const VIEW_COUNT_ROWS_PER_SITE_DAY = 5_000;

/** How many pages and how many referrers the page lists. */
export const STATS_TOP_LIMIT = 10;

/** The windows the Stats page offers, in days; `1` is today, by the hour. */
export const STATS_WINDOWS = [1, 7, 30] as const;
export type StatsWindow = (typeof STATS_WINDOWS)[number];
export const DEFAULT_STATS_WINDOW: StatsWindow = 1;

/**
 * Rows per upsert statement. Five bound parameters a row keeps a chunk under
 * D1's limit of 100 parameters per statement.
 */
const UPSERT_CHUNK_ROWS = 16;
/** Hour rows per statement: three parameters each. */
const HOUR_UPSERT_CHUNK_ROWS = 32;

/** Keys remembered as already in the table, before the set is emptied. */
const SEEN_KEYS_LIMIT = 50_000;

/**
 * What one process remembers between flushes: which counter keys it has
 * already written, so the row cap is only checked when a batch brings new
 * ones, and which day it last swept each site on.
 *
 * Module state rather than per-request state on purpose: on Workers a new
 * services object is built per request, and this has to survive them.
 */
export interface ViewCountWriterState {
  seen: Set<string>;
  sweptOn: Map<string, string>;
  /** Sites whose start day this process has already made sure of. */
  stamped: Set<string>;
}

/**
 * A fresh writer state. Tests construct one per test; production uses the
 * module's own.
 *
 * @returns Empty state
 * @example
 * ```ts
 * const stats = createStatsService(db, siteId, schema, "sqlite", {
 *   settings,
 *   writerState: createViewCountWriterState(),
 * });
 * ```
 */
export function createViewCountWriterState(): ViewCountWriterState {
  return { seen: new Set(), sweptOn: new Map(), stamped: new Set() };
}

const sharedWriterState = createViewCountWriterState();

/** Views at one point of a series: a day key, or an hour key for today. */
export interface StatsSeriesPoint {
  at: string;
  views: number;
}

/**
 * The chart's series. Today is drawn by the hour, up to the current one;
 * a longer window by the day, one point per day of the window.
 */
export interface StatsSeries {
  unit: "hour" | "day";
  points: StatsSeriesPoint[];
}

/** A counter row of the day table, as written. */
interface ViewDayRow {
  siteId: string;
  day: string;
  page: string;
  referrer: string;
  count: number;
}

/** A counter row of the hour table, as written. */
interface ViewHourRow {
  siteId: string;
  hour: string;
  count: number;
}

/** Views from one referring host. */
export interface StatsReferrerRow {
  host: string;
  views: number;
}

/**
 * A post among the pages. `post` is `null` once the post is deleted: its
 * rows stay until the sweep, and the list still accounts for them.
 */
export interface StatsPostPage {
  kind: "post";
  key: string;
  post: {
    /** The post's name as the rest of Jant writes it; empty when nothing gives one. */
    title: string;
    slug: string;
    format: Format;
  } | null;
}

/** A collection or smart collection among the pages; `null` once deleted. */
export interface StatsCollectionPage {
  kind: "collection";
  key: string;
  collection: { title: string; slug: string } | null;
}

/** Any other page, by the path it was opened at. */
export interface StatsPathPage {
  kind: "path";
  key: string;
}

/** One counted page, named. */
export type StatsPage = StatsPostPage | StatsCollectionPage | StatsPathPage;

/** A page in the top list. */
export type StatsPageRow = StatsPage & { views: number };

/** Where views came from, in the shape the page shows. */
export interface StatsReferrers {
  /** No referrer at all: a typed address, a bookmark, an app, a feed reader. */
  direct: number;
  /** A link from another page of the site. */
  internal: number;
  /** The busiest hosts, most views first. */
  top: StatsReferrerRow[];
  /** Every host past the top list, and the overflow row. */
  other: number;
}

/** The Stats page: the site over a window of days. */
export interface StatsOverview {
  days: number;
  /** First day of the window. */
  since: string;
  /** Last day of the window: today. */
  until: string;
  /**
   * The day counting began, when it falls inside the window; `null` when
   * every day of the window was counted. The days before it were never
   * counted, which is not the same as zero views.
   */
  start: string | null;
  total: number;
  /** Oldest first, zero where nothing was counted. */
  series: StatsSeries;
  /** The most-viewed pages, posts among them, most views first. */
  pages: StatsPageRow[];
  referrers: StatsReferrers;
}

/** One page over a window of days. */
export interface StatsPageDetail {
  page: StatsPage;
  days: number;
  since: string;
  until: string;
  /** As on the overview: the first counted day when inside the window. */
  start: string | null;
  total: number;
  /**
   * By the day; `null` for today, since hours are kept for the site as a
   * whole and not per page.
   */
  series: StatsSeries | null;
  referrers: StatsReferrers;
}

/** One referrer over a window of days: the pages it sent readers to. */
export interface StatsReferrerDetail {
  /** The referrer's counter key: a host or a tag, `""` for Direct, `/` for Internal. */
  referrer: string;
  days: number;
  since: string;
  until: string;
  /** As on the overview: the first counted day when inside the window. */
  start: string | null;
  total: number;
  /**
   * By the day; `null` for today, since hours are kept for the site as a
   * whole and not per referrer.
   */
  series: StatsSeries | null;
  /** The pages its readers opened most, most views first. */
  pages: StatsPageRow[];
}

export interface StatsService {
  /**
   * Write a batch of counted views, for any site: the day table by page and
   * referrer, the hour table as totals, applying the row cap and the sweep
   * on the way, and giving a site that has no start day yet the batch's
   * earliest day as its start. Entries of a site whose switch is off are
   * dropped: a hit added before the author turned stats off and flushed
   * after must not undo the deletion that came with it.
   *
   * @param entries - Views, already summed per site, hour, page and referrer
   * @param opts.dailyLimit - Views this instance may record per day; `0` for no limit
   * @param opts.today - Today's UTC day key, for the sweep and the limit
   * @returns Whether the daily limit has been reached
   */
  record(
    entries: ViewCountEntry[],
    opts: { dailyLimit: number; today: string },
  ): Promise<ViewRecordResult>;
  /**
   * The site's views over the last `days` days. A site with no start day
   * yet gets today as its start: the record begins with the first look at
   * it.
   *
   * @param opts.days - Length of the window; `1` is today, by the hour
   * @param opts.today - The site's current day key, the window's last day
   * @param opts.hour - The site's current hour key, the last hour drawn today
   * @returns The overview
   */
  getOverview(opts: {
    days: number;
    today: string;
    hour: string;
  }): Promise<StatsOverview>;
  /**
   * One page's views over the last `days` days, by its counter key: a
   * post's or collection's id, or a path.
   *
   * @param key - The page's counter key
   * @param opts.days - Length of the window; `1` is today
   * @param opts.today - The site's current day key, the window's last day
   * @param opts.hour - The site's current hour key
   * @returns The detail, or `null` for a key that names nothing the site
   *   has or ever counted
   */
  getPage(
    key: string,
    opts: { days: number; today: string; hour: string },
  ): Promise<StatsPageDetail | null>;
  /**
   * One referrer's views over the last `days` days, by its counter key: a
   * host or a tag as the referrer list shows it, `""` for direct visits,
   * `/` for internal navigation. Direct and Internal are referrers every
   * site has; a host or a tag is one of this site's once something was
   * counted under it, on any day still kept.
   *
   * @param key - The referrer's counter key
   * @param opts.days - Length of the window; `1` is today
   * @param opts.today - The site's current day key, the window's last day
   * @returns The detail, or `null` for a referrer the site never counted
   */
  getReferrer(
    key: string,
    opts: { days: number; today: string },
  ): Promise<StatsReferrerDetail | null>;
  /**
   * Delete every counter row the site has, and the day its record began:
   * whatever is counted next starts a new record.
   *
   * @returns Nothing
   */
  clear(): Promise<void>;
  /**
   * Turn counting on or off. Off also deletes the site's rows: a switch that
   * says off while ninety days of counts sit behind it would be a lie. On
   * makes today the start of the record unless one is already set.
   *
   * @param enabled - The new state
   * @param opts.today - The site's current day key
   * @returns Nothing
   */
  setEnabled(enabled: boolean, opts: { today: string }): Promise<void>;
}

function entryKey(entry: ViewDayRow): string {
  return `${entry.siteId}\n${entry.day}\n${entry.page}\n${entry.referrer}`;
}

/** The day table's rows for a batch: the hour folded away. */
function foldByDay(entries: ViewCountEntry[]): ViewDayRow[] {
  const rows = new Map<string, ViewDayRow>();
  for (const { siteId, day, page, referrer, count } of entries) {
    const row: ViewDayRow = { siteId, day, page, referrer, count };
    const known = rows.get(entryKey(row));
    if (known) known.count += count;
    else rows.set(entryKey(row), row);
  }
  return [...rows.values()];
}

/** The hour table's rows for a batch: the total per site and hour. */
function foldByHour(entries: ViewCountEntry[]): ViewHourRow[] {
  const rows = new Map<string, ViewHourRow>();
  for (const { siteId, hour, count } of entries) {
    const key = `${siteId}\n${hour}`;
    const known = rows.get(key);
    if (known) known.count += count;
    else rows.set(key, { siteId, hour, count });
  }
  return [...rows.values()];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Summarize referrer rows the way the page shows them: direct on its own,
 * the busiest hosts, and everything else as one number.
 */
function summarizeReferrers(rows: StatsReferrerRow[]): StatsReferrers {
  let direct = 0;
  let internal = 0;
  let other = 0;
  const named: StatsReferrerRow[] = [];
  for (const row of rows) {
    if (row.host === "") direct += row.views;
    else if (row.host === VIEW_INTERNAL_REFERRER) internal += row.views;
    else if (row.host === VIEW_OVERFLOW_KEY) other += row.views;
    else named.push(row);
  }
  named.sort((a, b) => b.views - a.views || a.host.localeCompare(b.host));
  const top = named.slice(0, STATS_TOP_LIMIT);
  for (const row of named.slice(STATS_TOP_LIMIT)) other += row.views;
  return { direct, internal, top, other };
}

/**
 * Fill a window with one point per day, zero where nothing was counted.
 */
function fillDays(
  rows: StatsSeriesPoint[],
  today: string,
  days: number,
): StatsSeriesPoint[] {
  const byDay = new Map(rows.map((row) => [row.at, row.views]));
  return dayKeysEndingAt(today, days).map((day) => ({
    at: day,
    views: byDay.get(day) ?? 0,
  }));
}

/**
 * Fill today with one point per hour up to the current one, zero where
 * nothing was counted; the hours still to come are not points.
 */
function fillHours(
  rows: StatsSeriesPoint[],
  today: string,
  hour: string,
): StatsSeriesPoint[] {
  const byHour = new Map(rows.map((row) => [row.at, row.views]));
  return hourKeysOfDay(today)
    .filter((key) => key <= hour)
    .map((key) => ({ at: key, views: byHour.get(key) ?? 0 }));
}

/**
 * Create the stats service.
 *
 * @param db - Database
 * @param siteId - The site the reads are scoped to
 * @param schema - Dialect schema bundle
 * @param dialect - Database dialect
 * @param deps.settings - The settings service, for the on/off switch
 * @param deps.writerState - Process memory for the write path; tests pass a fresh one
 * @param deps.rowsPerSiteDay - The row cap, `VIEW_COUNT_ROWS_PER_SITE_DAY` unless a test lowers it
 * @returns The service
 * @example
 * ```ts
 * const stats = createStatsService(db, siteId, schema, dialect, { settings });
 * const overview = await stats.getOverview({ days: 30, today: "2026-11-08" });
 * ```
 */
export function createStatsService(
  db: Database,
  siteId: string,
  schema: DatabaseSchema = sqliteSchemaBundle,
  dialect: DatabaseDialect = "sqlite",
  deps: {
    settings: SettingsService;
    writerState?: ViewCountWriterState;
    /** The row cap; tests lower it. */
    rowsPerSiteDay?: number;
  },
): StatsService {
  const {
    viewCounts,
    viewHours,
    posts,
    collections,
    smartCollections,
    pathRegistry,
    settings,
  } = schema;
  const state = deps.writerState ?? sharedWriterState;
  const rowsPerSiteDay = deps.rowsPerSiteDay ?? VIEW_COUNT_ROWS_PER_SITE_DAY;

  /** A post's address lives in `path_registry`, one `slug` row per post. */
  const postSlugJoin = and(
    eq(pathRegistry.siteId, posts.siteId),
    eq(pathRegistry.postId, posts.id),
    eq(pathRegistry.kind, "slug"),
  );

  /**
   * Apply the row cap: a group of entries for one site-day whose new keys
   * would push the day past the cap has those keys folded into the overflow
   * row. Only groups that carry keys this process has not written before cost
   * a count; a busy site's keys are all known after the first flush of the
   * day.
   */
  async function capRows(entries: ViewDayRow[]): Promise<ViewDayRow[]> {
    const groups = new Map<string, ViewDayRow[]>();
    for (const entry of entries) {
      const key = `${entry.siteId}\n${entry.day}`;
      const group = groups.get(key);
      if (group) group.push(entry);
      else groups.set(key, [entry]);
    }

    const rows: ViewDayRow[] = [];
    for (const group of groups.values()) {
      const unseen = new Set(
        group.filter((entry) => !state.seen.has(entryKey(entry))),
      );
      if (unseen.size === 0) {
        rows.push(...group);
        continue;
      }

      const first = group[0];
      if (!first) continue;
      const { siteId: groupSite, day } = first;
      const [counted] = await db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(viewCounts)
        .where(and(eq(viewCounts.siteId, groupSite), eq(viewCounts.day, day)));
      const room = Math.max(0, rowsPerSiteDay - (counted?.total ?? 0));
      if (unseen.size <= room) {
        rows.push(...group);
        continue;
      }

      // The busiest new pairs keep their own rows; the rest share one.
      const kept = new Set(
        [...unseen].sort((a, b) => b.count - a.count).slice(0, room),
      );
      let overflow = 0;
      for (const entry of group) {
        if (!unseen.has(entry) || kept.has(entry)) rows.push(entry);
        else overflow += entry.count;
      }
      if (overflow > 0) {
        rows.push({
          siteId: groupSite,
          day,
          page: VIEW_OVERFLOW_KEY,
          referrer: VIEW_OVERFLOW_KEY,
          count: overflow,
        });
      }
    }
    return rows;
  }

  function upsertDays(executor: Database, rows: ViewDayRow[]) {
    return executor
      .insert(viewCounts)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          viewCounts.siteId,
          viewCounts.day,
          viewCounts.page,
          viewCounts.referrer,
        ],
        // Qualified on purpose: Postgres has both the row and `excluded` in
        // scope in a DO UPDATE and rejects a bare `count` as ambiguous; SQLite
        // accepts either form.
        set: { count: sql`${viewCounts.count} + excluded.count` },
      });
  }

  function upsertHours(executor: Database, rows: ViewHourRow[]) {
    return executor
      .insert(viewHours)
      .values(rows)
      .onConflictDoUpdate({
        target: [viewHours.siteId, viewHours.hour],
        set: { count: sql`${viewHours.count} + excluded.count` },
      });
  }

  /** Both tables' upserts, in one transaction or one batch. */
  async function writeRows(
    dayRows: ViewDayRow[],
    hourRows: ViewHourRow[],
  ): Promise<void> {
    const dayChunks = chunk(dayRows, UPSERT_CHUNK_ROWS);
    const hourChunks = chunk(hourRows, HOUR_UPSERT_CHUNK_ROWS);
    if (supportsDrizzleTransaction(db, dialect)) {
      await db.transaction(async (tx) => {
        const executor = tx as unknown as Database;
        for (const part of dayChunks) await upsertDays(executor, part);
        for (const part of hourChunks) await upsertHours(executor, part);
      });
      return;
    }
    const queries = [
      ...dayChunks.map((part) => upsertDays(db, part)),
      ...hourChunks.map((part) => upsertHours(db, part)),
    ];
    await db.batch(
      queries as [(typeof queries)[number], ...(typeof queries)[number][]],
    );
  }

  /**
   * The batch without the sites whose switch is off. Read from the table
   * rather than the settings service because a batch spans sites, and read
   * on every flush, so the promise `clear()` made holds across processes.
   */
  async function withoutSwitchedOff(
    entries: ViewCountEntry[],
  ): Promise<ViewCountEntry[]> {
    if (entries.length === 0) return entries;
    const siteIds = [...new Set(entries.map((entry) => entry.siteId))];
    const off = await db
      .select({ siteId: settings.siteId })
      .from(settings)
      .where(
        and(
          inArray(settings.siteId, siteIds),
          eq(settings.key, "STATS_ENABLED"),
          eq(settings.value, "false"),
        ),
      );
    if (off.length === 0) return entries;
    const offSites = new Set(off.map((row) => row.siteId));
    return entries.filter((entry) => !offSites.has(entry.siteId));
  }

  function rememberRows(rows: ViewDayRow[]): void {
    if (state.seen.size + rows.length > SEEN_KEYS_LIMIT) state.seen.clear();
    for (const row of rows) state.seen.add(entryKey(row));
  }

  /**
   * Give each touched site a start day if it has none: the batch's earliest
   * day for that site. Once per site per process, like the sweep; `clear()`
   * forgets the site so the next flush stamps it again. Written through the
   * table rather than the settings service because a batch spans sites.
   */
  async function stampStart(rows: ViewDayRow[]): Promise<void> {
    const firstDays = new Map<string, string>();
    for (const row of rows) {
      const known = firstDays.get(row.siteId);
      if (known === undefined || row.day < known) {
        firstDays.set(row.siteId, row.day);
      }
    }
    for (const [touchedSite, day] of firstDays) {
      if (state.stamped.has(touchedSite)) continue;
      state.stamped.add(touchedSite);
      await db
        .insert(settings)
        .values({
          siteId: touchedSite,
          key: "STATS_SINCE",
          value: day,
          updatedAt: now(),
        })
        .onConflictDoNothing();
    }
  }

  /**
   * Where the record starts, for a window: the stored start day when it
   * falls inside the window, pulled back to the first counted day should a
   * row predate it, and `null` when every day of the window was counted. A
   * site with no start yet gets today as its start, stored for next time.
   */
  async function startOfRecord(
    stored: string | null,
    { since, today }: { since: string; today: string },
    counted: StatsSeriesPoint[],
  ): Promise<string | null> {
    let start = stored !== null && isDayKey(stored) ? stored : null;
    if (start === null) {
      start = today;
      state.stamped.add(siteId);
      await deps.settings.set("STATS_SINCE", today);
    }
    if (start > today) start = today;
    for (const row of counted) {
      if (row.at < start) start = row.at;
    }
    return start > since ? start : null;
  }

  /**
   * Delete each touched site's rows past the retention windows, once a day:
   * the last `VIEW_COUNT_RETENTION_DAYS` days of counters, today included,
   * and the last `VIEW_HOUR_RETENTION_DAYS` days of hours.
   */
  async function sweep(rows: ViewDayRow[], today: string): Promise<void> {
    const cutoff = shiftDayKey(today, -(VIEW_COUNT_RETENTION_DAYS - 1));
    const hourCutoff = `${shiftDayKey(today, -(VIEW_HOUR_RETENTION_DAYS - 1))}T00`;
    for (const touchedSite of new Set(rows.map((row) => row.siteId))) {
      if (state.sweptOn.get(touchedSite) === today) continue;
      state.sweptOn.set(touchedSite, today);
      await db
        .delete(viewCounts)
        .where(
          and(eq(viewCounts.siteId, touchedSite), lt(viewCounts.day, cutoff)),
        );
      await db
        .delete(viewHours)
        .where(
          and(
            eq(viewHours.siteId, touchedSite),
            lt(viewHours.hour, hourCutoff),
          ),
        );
    }
  }

  /**
   * Whether the views recorded for the batch's days have reached the
   * instance's daily limit. The limit guards a quota that resets at UTC
   * midnight while rows are filed by the site's own day; the two differ by
   * at most a time zone, and the limit leaves room for that.
   */
  async function limitReached(
    rows: ViewDayRow[],
    dailyLimit: number,
  ): Promise<boolean> {
    if (dailyLimit <= 0) return false;
    const [summed] = await db
      .select({
        total: sql<number>`coalesce(sum(${viewCounts.count}), 0)`.mapWith(
          Number,
        ),
      })
      .from(viewCounts)
      .where(
        and(
          inArray(viewCounts.siteId, [...new Set(rows.map((r) => r.siteId))]),
          inArray(viewCounts.day, [...new Set(rows.map((r) => r.day))]),
        ),
      );
    return (summed?.total ?? 0) >= dailyLimit;
  }

  /** What a window query is narrowed to: one page, or one referrer. */
  interface WindowFilter {
    page?: string;
    referrer?: string;
  }

  function windowCondition(
    since: string,
    today: string,
    { page, referrer }: WindowFilter = {},
  ) {
    return and(
      eq(viewCounts.siteId, siteId),
      gte(viewCounts.day, since),
      lte(viewCounts.day, today),
      page === undefined ? undefined : eq(viewCounts.page, page),
      referrer === undefined ? undefined : eq(viewCounts.referrer, referrer),
    );
  }

  function seriesQuery(since: string, today: string, filter?: WindowFilter) {
    return db
      .select({
        at: viewCounts.day,
        views: sql<number>`sum(${viewCounts.count})`.mapWith(Number),
      })
      .from(viewCounts)
      .where(windowCondition(since, today, filter))
      .groupBy(viewCounts.day);
  }

  /** Today's hour totals, for the chart. */
  function hoursQuery(today: string) {
    return db
      .select({ at: viewHours.hour, views: viewHours.count })
      .from(viewHours)
      .where(
        and(
          eq(viewHours.siteId, siteId),
          gte(viewHours.hour, `${today}T00`),
          lte(viewHours.hour, `${today}T23`),
        ),
      );
  }

  function referrersQuery(since: string, today: string, filter?: WindowFilter) {
    return db
      .select({
        host: viewCounts.referrer,
        views: sql<number>`sum(${viewCounts.count})`.mapWith(Number),
      })
      .from(viewCounts)
      .where(windowCondition(since, today, filter))
      .groupBy(viewCounts.referrer);
  }

  /**
   * The busiest keys of the window, whatever they name; the overflow row is
   * a remainder, not a page. Names come after, by kind.
   */
  function topPagesQuery(since: string, today: string, filter?: WindowFilter) {
    const views = sql<number>`sum(${viewCounts.count})`;
    return db
      .select({ key: viewCounts.page, views: views.mapWith(Number) })
      .from(viewCounts)
      .where(
        and(
          windowCondition(since, today, filter),
          ne(viewCounts.page, VIEW_OVERFLOW_KEY),
        ),
      )
      .groupBy(viewCounts.page)
      .orderBy(desc(views), asc(viewCounts.page))
      .limit(STATS_TOP_LIMIT);
  }

  /** The posts among some ids, named and addressed; a deleted one is absent. */
  async function describePosts(
    ids: string[],
  ): Promise<Map<string, NonNullable<StatsPostPage["post"]>>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({
        id: posts.id,
        title: posts.title,
        format: posts.format,
        url: posts.url,
        body: posts.body,
        bodyText: posts.bodyText,
        quoteText: posts.quoteText,
        summary: posts.summary,
        slug: pathRegistry.path,
      })
      .from(posts)
      .innerJoin(pathRegistry, postSlugJoin)
      .where(and(eq(posts.siteId, siteId), inArray(posts.id, ids)));
    return new Map(
      rows.map((row) => [
        row.id,
        {
          title: getPostDisplayTitle(row),
          slug: row.slug,
          format: row.format,
        },
      ]),
    );
  }

  /** The collections among some ids, with their address; a deleted one is absent. */
  async function describeCollections(
    ids: string[],
  ): Promise<Map<string, NonNullable<StatsCollectionPage["collection"]>>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({
        id: collections.id,
        title: collections.title,
        slug: pathRegistry.path,
      })
      .from(collections)
      .innerJoin(
        pathRegistry,
        and(
          eq(pathRegistry.siteId, collections.siteId),
          eq(pathRegistry.collectionId, collections.id),
          eq(pathRegistry.kind, "slug"),
        ),
      )
      .where(and(eq(collections.siteId, siteId), inArray(collections.id, ids)));
    return new Map(
      rows.map((row) => [row.id, { title: row.title, slug: row.slug }]),
    );
  }

  /** The smart collections among some ids, the same way. */
  async function describeSmartCollections(
    ids: string[],
  ): Promise<Map<string, NonNullable<StatsCollectionPage["collection"]>>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({
        id: smartCollections.id,
        title: smartCollections.title,
        slug: pathRegistry.path,
      })
      .from(smartCollections)
      .innerJoin(
        pathRegistry,
        and(
          eq(pathRegistry.siteId, smartCollections.siteId),
          eq(pathRegistry.smartCollectionId, smartCollections.id),
          eq(pathRegistry.kind, "slug"),
        ),
      )
      .where(
        and(
          eq(smartCollections.siteId, siteId),
          inArray(smartCollections.id, ids),
        ),
      );
    return new Map(
      rows.map((row) => [row.id, { title: row.title, slug: row.slug }]),
    );
  }

  /**
   * Name each key: a post or a collection from its table, a path as itself.
   * Three lookups at most, side by side; a key of no known shape is left out.
   */
  async function describePages(
    keys: string[],
  ): Promise<Map<string, StatsPage>> {
    const ids = {
      post: [] as string[],
      collection: [] as string[],
      smart: [] as string[],
    };
    for (const key of keys) {
      const kind = viewPageKind(key);
      if (kind === "post") ids.post.push(key);
      else if (kind === "collection") ids.collection.push(key);
      else if (kind === "smartCollection") ids.smart.push(key);
    }
    const [postRows, collectionRows, smartRows] = await Promise.all([
      describePosts(ids.post),
      describeCollections(ids.collection),
      describeSmartCollections(ids.smart),
    ]);
    const pages = new Map<string, StatsPage>();
    for (const key of keys) {
      switch (viewPageKind(key)) {
        case "path":
          pages.set(key, { kind: "path", key });
          break;
        case "post":
          pages.set(key, {
            kind: "post",
            key,
            post: postRows.get(key) ?? null,
          });
          break;
        case "collection":
          pages.set(key, {
            kind: "collection",
            key,
            collection: collectionRows.get(key) ?? null,
          });
          break;
        case "smartCollection":
          pages.set(key, {
            kind: "collection",
            key,
            collection: smartRows.get(key) ?? null,
          });
          break;
        default:
          break;
      }
    }
    return pages;
  }

  /** Whether the site ever counted a key, on any day still kept. */
  async function hasRows(key: string): Promise<boolean> {
    const [row] = await db
      .select({ page: viewCounts.page })
      .from(viewCounts)
      .where(and(eq(viewCounts.siteId, siteId), eq(viewCounts.page, key)))
      .limit(1);
    return row !== undefined;
  }

  /** Whether the site ever counted a view from a referrer, on any day still kept. */
  async function hasReferrerRows(key: string): Promise<boolean> {
    const [row] = await db
      .select({ referrer: viewCounts.referrer })
      .from(viewCounts)
      .where(and(eq(viewCounts.siteId, siteId), eq(viewCounts.referrer, key)))
      .limit(1);
    return row !== undefined;
  }

  return {
    async record(entries, opts) {
      const counted = await withoutSwitchedOff(entries);
      if (counted.length === 0) return { limitReached: false };
      const rows = await capRows(foldByDay(counted));
      await writeRows(rows, foldByHour(counted));
      rememberRows(rows);
      await stampStart(rows);
      await sweep(rows, opts.today);
      return { limitReached: await limitReached(rows, opts.dailyLimit) };
    },

    async getOverview({ days, today, hour }) {
      const since = shiftDayKey(today, -(days - 1));
      const [seriesRows, hourRows, topRows, referrerRows, stored] =
        await Promise.all([
          seriesQuery(since, today),
          days === 1 ? hoursQuery(today) : Promise.resolve([]),
          topPagesQuery(since, today),
          referrersQuery(since, today),
          deps.settings.get("STATS_SINCE"),
        ]);
      const named = await describePages(topRows.map((row) => row.key));
      const dayPoints = fillDays(seriesRows, today, days);
      const series: StatsSeries =
        days === 1
          ? { unit: "hour", points: fillHours(hourRows, today, hour) }
          : { unit: "day", points: dayPoints };
      return {
        days,
        since,
        until: today,
        start: await startOfRecord(stored, { since, today }, seriesRows),
        // The day table's sum: the same rows the lists come from.
        total: dayPoints.reduce((sum, point) => sum + point.views, 0),
        series,
        pages: topRows.flatMap((row) => {
          const page = named.get(row.key);
          return page ? [{ ...page, views: row.views }] : [];
        }),
        referrers: summarizeReferrers(referrerRows),
      };
    },

    async getPage(key, { days, today }) {
      const kind = viewPageKind(key);
      if (kind === null || kind === "overflow") return null;
      const since = shiftDayKey(today, -(days - 1));
      const [named, seriesRows, referrerRows, stored] = await Promise.all([
        describePages([key]),
        seriesQuery(since, today, { page: key }),
        referrersQuery(since, today, { page: key }),
        deps.settings.get("STATS_SINCE"),
      ]);
      const page = named.get(key);
      if (!page) return null;
      // A path, or an id whose entity is gone, is a page of this site only
      // if something was ever counted under it; anything else typed into
      // the address bar is not.
      const exists =
        page.kind === "post"
          ? page.post !== null
          : page.kind === "collection"
            ? page.collection !== null
            : false;
      if (!exists && !(await hasRows(key))) return null;
      const points = fillDays(seriesRows, today, days);
      return {
        page,
        days,
        since,
        until: today,
        // The site's start, not the page's: the page's own first view is
        // a bar on the chart, not where the record begins.
        start: await startOfRecord(stored, { since, today }, []),
        total: points.reduce((sum, point) => sum + point.views, 0),
        // A page has no hours of its own: today shows its total and sources.
        series: days === 1 ? null : { unit: "day", points },
        referrers: summarizeReferrers(referrerRows),
      };
    },

    async getReferrer(key, { days, today }) {
      // The overflow row is a remainder, not somewhere readers came from.
      if (key === VIEW_OVERFLOW_KEY) return null;
      const since = shiftDayKey(today, -(days - 1));
      const [seriesRows, topRows, stored] = await Promise.all([
        seriesQuery(since, today, { referrer: key }),
        topPagesQuery(since, today, { referrer: key }),
        deps.settings.get("STATS_SINCE"),
      ]);
      // Direct and Internal exist for every site. A host or a tag typed into
      // the address bar is a referrer of this site only if it ever sent a
      // view, inside the window or on an older day still kept.
      const known =
        key === "" || key === VIEW_INTERNAL_REFERRER || topRows.length > 0;
      if (!known && !(await hasReferrerRows(key))) return null;
      const named = await describePages(topRows.map((row) => row.key));
      const points = fillDays(seriesRows, today, days);
      return {
        referrer: key,
        days,
        since,
        until: today,
        // The site's start, as on a page's own numbers.
        start: await startOfRecord(stored, { since, today }, []),
        total: points.reduce((sum, point) => sum + point.views, 0),
        // A referrer has no hours of its own: today shows its total and pages.
        series: days === 1 ? null : { unit: "day", points },
        pages: topRows.flatMap((row) => {
          const page = named.get(row.key);
          return page ? [{ ...page, views: row.views }] : [];
        }),
      };
    },

    async clear() {
      await db.delete(viewCounts).where(eq(viewCounts.siteId, siteId));
      await db.delete(viewHours).where(eq(viewHours.siteId, siteId));
      await deps.settings.remove("STATS_SINCE");
      state.stamped.delete(siteId);
    },

    async setEnabled(enabled, { today }) {
      await deps.settings.set("STATS_ENABLED", enabled ? "true" : "false");
      if (!enabled) {
        await this.clear();
        return;
      }
      if ((await deps.settings.get("STATS_SINCE")) === null) {
        state.stamped.add(siteId);
        await deps.settings.set("STATS_SINCE", today);
      }
    },
  };
}
