/**
 * View stats: what is kept, how it is written, and what the Stats page reads.
 *
 * Jant counts page views so an author can see, on one quiet page, which days
 * and which posts were read and where readers came from — and nothing else.
 * No reader is identified: there are no uniques, no countries, no devices,
 * and no record of any visit. What exists is one counter per site, day, page
 * and referring host (`view_count`), and this file is the whole policy for
 * that table.
 *
 * - **A row is a counter.** Ten thousand readers opening one post from one
 *   link are one row. The table grows with the variety of a day's traffic,
 *   never its volume.
 * - **Ninety days.** Rows older than `VIEW_COUNT_RETENTION_DAYS` are deleted,
 *   once a day per site, by whichever flush comes first. Nothing is rolled up:
 *   a lifetime total is exactly the scoreboard this feature is not.
 * - **Bounded breakdown.** A site-day holds at most
 *   `VIEW_COUNT_ROWS_PER_SITE_DAY` rows; past that, new page-referrer pairs
 *   land on one overflow row, so a script spraying made-up referrers cannot
 *   grow the table. Totals stay exact, the breakdown stops.
 * - **Bounded writes.** On Cloudflare, free-tier D1 allows 100,000 rows
 *   written per UTC day and refuses every query once that is spent, so a
 *   well-read day must never be able to take the site down. Writes arrive in
 *   batches from `lib/view-buffer.ts`, and once a day's recorded views reach
 *   the instance's `STATS_DAILY_LIMIT` the buffer stops until the next day.
 *
 * `record()` is the one write path. It takes entries for any site, because a
 * batch holds whatever the process saw in its last few seconds; the reads are
 * scoped to the service's site like every other service.
 */

import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { supportsDrizzleTransaction, type Database } from "../db/index.js";
import type { DatabaseDialect } from "../db/dialect.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import type { ViewCountEntry, ViewRecordResult } from "../lib/view-buffer.js";
import {
  dayKeysEndingAt,
  shiftDayKey,
  VIEW_OVERFLOW_KEY,
} from "../lib/view-counting.js";
import type { Format } from "../types/constants.js";
import type { SettingsService } from "./settings.js";

/** Days a counter row is kept before the sweep deletes it. */
export const VIEW_COUNT_RETENTION_DAYS = 90;

/** Rows one site may hold for one day before new pairs fold into overflow. */
export const VIEW_COUNT_ROWS_PER_SITE_DAY = 5_000;

/** How many posts and how many referrers the page lists. */
export const STATS_TOP_LIMIT = 10;

/** The windows the Stats page offers, in days. */
export const STATS_WINDOWS = [7, 30, 90] as const;
export type StatsWindow = (typeof STATS_WINDOWS)[number];
export const DEFAULT_STATS_WINDOW: StatsWindow = 30;

/**
 * Rows per upsert statement. Five bound parameters a row keeps a chunk under
 * D1's limit of 100 parameters per statement.
 */
const UPSERT_CHUNK_ROWS = 16;

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
  return { seen: new Set(), sweptOn: new Map() };
}

const sharedWriterState = createViewCountWriterState();

/** Views on one day. */
export interface StatsSeriesPoint {
  day: string;
  views: number;
}

/** A post in the top list, with what a link to it needs. */
export interface StatsPostRow {
  id: string;
  title: string | null;
  slug: string;
  format: Format;
  views: number;
}

/** Views from one referring host. */
export interface StatsReferrerRow {
  host: string;
  views: number;
}

/** Where views came from, in the shape the page shows. */
export interface StatsReferrers {
  /** No referrer, or a link from the site itself. */
  direct: number;
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
  total: number;
  /** One point per day of the window, oldest first, zero where nothing was counted. */
  series: StatsSeriesPoint[];
  /** The most-viewed posts, most views first. */
  posts: StatsPostRow[];
  referrers: StatsReferrers;
}

/** One post over a window of days. */
export interface StatsPostDetail {
  post: Omit<StatsPostRow, "views">;
  days: number;
  since: string;
  until: string;
  total: number;
  series: StatsSeriesPoint[];
  referrers: StatsReferrers;
}

export interface StatsService {
  /**
   * Write a batch of counted views, for any site, applying the row cap and
   * the sweep on the way.
   *
   * @param entries - Views, already summed per site, day, page and referrer
   * @param opts.dailyLimit - Views this instance may record per day; `0` for no limit
   * @param opts.today - Today's UTC day key, for the sweep and the limit
   * @returns Whether the daily limit has been reached
   */
  record(
    entries: ViewCountEntry[],
    opts: { dailyLimit: number; today: string },
  ): Promise<ViewRecordResult>;
  /**
   * The site's views over the last `days` days.
   *
   * @param opts.days - Length of the window
   * @param opts.today - The site's current day key, the window's last day
   * @returns The overview
   */
  getOverview(opts: { days: number; today: string }): Promise<StatsOverview>;
  /**
   * One post's views over the last `days` days.
   *
   * @param postId - The post
   * @param opts.days - Length of the window
   * @param opts.today - The site's current day key, the window's last day
   * @returns The detail, or `null` when the site has no such post
   */
  getPost(
    postId: string,
    opts: { days: number; today: string },
  ): Promise<StatsPostDetail | null>;
  /**
   * Delete every counter row the site has.
   *
   * @returns Nothing
   */
  clear(): Promise<void>;
  /**
   * Turn counting on or off. Off also deletes the site's rows: a switch that
   * says off while ninety days of counts sit behind it would be a lie.
   *
   * @param enabled - The new state
   * @returns Nothing
   */
  setEnabled(enabled: boolean): Promise<void>;
}

function entryKey(entry: ViewCountEntry): string {
  return `${entry.siteId}\n${entry.day}\n${entry.page}\n${entry.referrer}`;
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
  let other = 0;
  const named: StatsReferrerRow[] = [];
  for (const row of rows) {
    if (row.host === "") direct += row.views;
    else if (row.host === VIEW_OVERFLOW_KEY) other += row.views;
    else named.push(row);
  }
  named.sort((a, b) => b.views - a.views || a.host.localeCompare(b.host));
  const top = named.slice(0, STATS_TOP_LIMIT);
  for (const row of named.slice(STATS_TOP_LIMIT)) other += row.views;
  return { direct, top, other };
}

/**
 * Fill a window with one point per day, zero where nothing was counted.
 */
function fillSeries(
  rows: StatsSeriesPoint[],
  today: string,
  days: number,
): StatsSeriesPoint[] {
  const byDay = new Map(rows.map((row) => [row.day, row.views]));
  return dayKeysEndingAt(today, days).map((day) => ({
    day,
    views: byDay.get(day) ?? 0,
  }));
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
  const { viewCounts, posts, pathRegistry } = schema;
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
  async function capRows(entries: ViewCountEntry[]): Promise<ViewCountEntry[]> {
    const groups = new Map<string, ViewCountEntry[]>();
    for (const entry of entries) {
      const key = `${entry.siteId}\n${entry.day}`;
      const group = groups.get(key);
      if (group) group.push(entry);
      else groups.set(key, [entry]);
    }

    const rows: ViewCountEntry[] = [];
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

  function upsert(executor: Database, rows: ViewCountEntry[]) {
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
        // Unqualified on purpose: in a DO UPDATE both SQLite and Postgres read
        // a bare column as the existing row's, and `excluded` as the new one.
        set: { count: sql`count + excluded.count` },
      });
  }

  async function writeRows(rows: ViewCountEntry[]): Promise<void> {
    const chunks = chunk(rows, UPSERT_CHUNK_ROWS);
    if (supportsDrizzleTransaction(db, dialect)) {
      await db.transaction(async (tx) => {
        for (const part of chunks) {
          await upsert(tx as unknown as Database, part);
        }
      });
      return;
    }
    const queries = chunks.map((part) => upsert(db, part));
    await db.batch(
      queries as [(typeof queries)[number], ...(typeof queries)[number][]],
    );
  }

  function rememberRows(rows: ViewCountEntry[]): void {
    if (state.seen.size + rows.length > SEEN_KEYS_LIMIT) state.seen.clear();
    for (const row of rows) state.seen.add(entryKey(row));
  }

  /**
   * Delete each touched site's rows past the retention window, once a day.
   * The window is the last `VIEW_COUNT_RETENTION_DAYS` days, today included.
   */
  async function sweep(rows: ViewCountEntry[], today: string): Promise<void> {
    const cutoff = shiftDayKey(today, -(VIEW_COUNT_RETENTION_DAYS - 1));
    for (const touchedSite of new Set(rows.map((row) => row.siteId))) {
      if (state.sweptOn.get(touchedSite) === today) continue;
      state.sweptOn.set(touchedSite, today);
      await db
        .delete(viewCounts)
        .where(
          and(eq(viewCounts.siteId, touchedSite), lt(viewCounts.day, cutoff)),
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
    rows: ViewCountEntry[],
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

  function windowCondition(since: string, today: string, page?: string) {
    return and(
      eq(viewCounts.siteId, siteId),
      gte(viewCounts.day, since),
      lte(viewCounts.day, today),
      page === undefined ? undefined : eq(viewCounts.page, page),
    );
  }

  function seriesQuery(since: string, today: string, page?: string) {
    return db
      .select({
        day: viewCounts.day,
        views: sql<number>`sum(${viewCounts.count})`.mapWith(Number),
      })
      .from(viewCounts)
      .where(windowCondition(since, today, page))
      .groupBy(viewCounts.day);
  }

  function referrersQuery(since: string, today: string, page?: string) {
    return db
      .select({
        host: viewCounts.referrer,
        views: sql<number>`sum(${viewCounts.count})`.mapWith(Number),
      })
      .from(viewCounts)
      .where(windowCondition(since, today, page))
      .groupBy(viewCounts.referrer);
  }

  function topPostsQuery(since: string, today: string) {
    const views = sql<number>`sum(${viewCounts.count})`;
    return db
      .select({
        id: viewCounts.page,
        title: posts.title,
        slug: pathRegistry.path,
        format: posts.format,
        views: views.mapWith(Number),
      })
      .from(viewCounts)
      .innerJoin(
        posts,
        and(eq(posts.id, viewCounts.page), eq(posts.siteId, viewCounts.siteId)),
      )
      .innerJoin(pathRegistry, postSlugJoin)
      .where(windowCondition(since, today))
      .groupBy(viewCounts.page, posts.title, pathRegistry.path, posts.format)
      .orderBy(desc(views), asc(viewCounts.page))
      .limit(STATS_TOP_LIMIT);
  }

  return {
    async record(entries, opts) {
      if (entries.length === 0) return { limitReached: false };
      const rows = await capRows(entries);
      await writeRows(rows);
      rememberRows(rows);
      await sweep(rows, opts.today);
      return { limitReached: await limitReached(rows, opts.dailyLimit) };
    },

    async getOverview({ days, today }) {
      const since = shiftDayKey(today, -(days - 1));
      const [seriesRows, postRows, referrerRows] = await Promise.all([
        seriesQuery(since, today),
        topPostsQuery(since, today),
        referrersQuery(since, today),
      ]);
      const series = fillSeries(seriesRows, today, days);
      return {
        days,
        since,
        until: today,
        total: series.reduce((sum, point) => sum + point.views, 0),
        series,
        posts: postRows,
        referrers: summarizeReferrers(referrerRows),
      };
    },

    async getPost(postId, { days, today }) {
      const since = shiftDayKey(today, -(days - 1));
      const [post, seriesRows, referrerRows] = await Promise.all([
        db
          .select({
            id: posts.id,
            title: posts.title,
            slug: pathRegistry.path,
            format: posts.format,
          })
          .from(posts)
          .innerJoin(pathRegistry, postSlugJoin)
          .where(and(eq(posts.id, postId), eq(posts.siteId, siteId)))
          .then((rows) => rows[0] ?? null),
        seriesQuery(since, today, postId),
        referrersQuery(since, today, postId),
      ]);
      if (!post) return null;
      const series = fillSeries(seriesRows, today, days);
      return {
        post,
        days,
        since,
        until: today,
        total: series.reduce((sum, point) => sum + point.views, 0),
        series,
        referrers: summarizeReferrers(referrerRows),
      };
    },

    async clear() {
      await db.delete(viewCounts).where(eq(viewCounts.siteId, siteId));
    },

    async setEnabled(enabled) {
      await deps.settings.set("STATS_ENABLED", enabled ? "true" : "false");
      if (!enabled) await this.clear();
    },
  };
}
