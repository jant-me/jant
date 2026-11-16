import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import type { Database } from "../../db/index.js";
import { createCollectionService } from "../collection.js";
import { createPathService } from "../path.js";
import { createPostService } from "../post.js";
import { createSmartCollectionService } from "../smart-collection.js";
import { createSettingsService } from "../settings.js";
import {
  createStatsService,
  createViewCountWriterState,
  VIEW_COUNT_RETENTION_DAYS,
} from "../stats.js";
import type { ViewCountEntry } from "../../lib/view-buffer.js";
import {
  shiftDayKey,
  VIEW_INTERNAL_REFERRER,
  VIEW_OVERFLOW_KEY,
} from "../../lib/view-counting.js";

const TODAY = "2026-11-08";
const HOUR = `${TODAY}T12`;
const SITE = DEFAULT_TEST_SITE_ID;
/** A well-formed id of a post the site no longer has. */
const GONE_POST = "pst_00000000000000000000000000";

function entry(
  overrides: Partial<ViewCountEntry> & { page: string },
): ViewCountEntry {
  return {
    siteId: SITE,
    day: TODAY,
    hour: HOUR,
    referrer: "",
    count: 1,
    ...overrides,
  };
}

describe("StatsService", () => {
  let db: Database;
  let stats: ReturnType<typeof createStatsService>;
  let settings: ReturnType<typeof createSettingsService>;
  let posts: ReturnType<typeof createPostService>;
  let collections: ReturnType<typeof createCollectionService>;
  let smartCollections: ReturnType<typeof createSmartCollectionService>;

  function createStats(rowsPerSiteDay?: number) {
    return createStatsService(db, SITE, undefined, "sqlite", {
      settings,
      writerState: createViewCountWriterState(),
      rowsPerSiteDay,
    });
  }

  async function rowCount(): Promise<number> {
    const rows = (await db.all(
      sql`SELECT count(*) AS total FROM view_count WHERE site_id = ${SITE}`,
    )) as { total: number }[];
    return rows[0]?.total ?? 0;
  }

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    settings = createSettingsService(db, SITE);
    posts = createPostService(db, { slugIdLength: 5 }, SITE);
    const paths = createPathService(db, SITE);
    collections = createCollectionService(db, SITE, paths);
    smartCollections = createSmartCollectionService(db, SITE, paths, posts);
    stats = createStats();
  });

  describe("record", () => {
    it("adds a batch onto the counters it already has", async () => {
      await stats.record([entry({ page: "/", count: 2 })], {
        dailyLimit: 0,
        today: TODAY,
      });
      await stats.record(
        [entry({ page: "/", count: 3 }), entry({ page: "/", referrer: "a.b" })],
        { dailyLimit: 0, today: TODAY },
      );

      const overview = await stats.getOverview({
        days: 7,
        today: TODAY,
        hour: `${TODAY}T12`,
      });
      expect(overview.total).toBe(6);
      expect(overview.referrers).toEqual({
        direct: 5,
        internal: 0,
        top: [{ host: "a.b", views: 1 }],
        other: 0,
      });
      expect(await rowCount()).toBe(2);
    });

    it("writes batches larger than one statement can carry", async () => {
      const entries = Array.from({ length: 50 }, (_, index) =>
        entry({ page: `/page-${index}` }),
      );
      await stats.record(entries, { dailyLimit: 0, today: TODAY });

      expect(await rowCount()).toBe(50);
      expect(
        (
          await stats.getOverview({
            days: 1,
            today: TODAY,
            hour: `${TODAY}T12`,
          })
        ).total,
      ).toBe(50);
    });

    it("folds new pairs into the overflow row once a day is at the cap", async () => {
      const capped = createStats(3);

      await capped.record([entry({ page: "/a" }), entry({ page: "/b" })], {
        dailyLimit: 0,
        today: TODAY,
      });
      // Two rows exist; room for one more. The busiest new pair keeps its
      // row, the other two share the overflow row, and known pairs are
      // never folded.
      await capped.record(
        [
          entry({ page: "/a", count: 10 }),
          entry({ page: "/c", count: 5 }),
          entry({ page: "/d", count: 2 }),
          entry({ page: "/e", count: 1 }),
        ],
        { dailyLimit: 0, today: TODAY },
      );

      const rows = (await db.all(
        sql`SELECT page, referrer, count FROM view_count WHERE site_id = ${SITE} ORDER BY page`,
      )) as { page: string; referrer: string; count: number }[];
      expect(rows).toEqual([
        { page: VIEW_OVERFLOW_KEY, referrer: VIEW_OVERFLOW_KEY, count: 3 },
        { page: "/a", referrer: "", count: 11 },
        { page: "/b", referrer: "", count: 1 },
        { page: "/c", referrer: "", count: 5 },
      ]);
      // The day's total is still exact.
      expect(
        (
          await capped.getOverview({
            days: 1,
            today: TODAY,
            hour: `${TODAY}T12`,
          })
        ).total,
      ).toBe(20);
    });

    it("sweeps rows past the retention window", async () => {
      const kept = shiftDayKey(TODAY, -(VIEW_COUNT_RETENTION_DAYS - 1));
      const expired = shiftDayKey(TODAY, -VIEW_COUNT_RETENTION_DAYS);
      await stats.record(
        [entry({ page: "/", day: kept }), entry({ page: "/", day: expired })],
        { dailyLimit: 0, today: shiftDayKey(TODAY, -1) },
      );
      expect(await rowCount()).toBe(2);

      await stats.record([entry({ page: "/" })], {
        dailyLimit: 0,
        today: TODAY,
      });

      const days = (await db.all(
        sql`SELECT day FROM view_count WHERE site_id = ${SITE} ORDER BY day`,
      )) as { day: string }[];
      expect(days.map((row) => row.day)).toEqual([kept, TODAY]);
    });

    it("sweeps hours older than yesterday", async () => {
      const old = shiftDayKey(TODAY, -3);
      await stats.record([entry({ page: "/", day: old, hour: `${old}T10` })], {
        dailyLimit: 0,
        today: old,
      });
      await stats.record([entry({ page: "/" })], {
        dailyLimit: 0,
        today: TODAY,
      });

      const hours = (await db.all(
        sql`SELECT hour FROM view_hour WHERE site_id = ${SITE} ORDER BY hour`,
      )) as { hour: string }[];
      expect(hours.map((row) => row.hour)).toEqual([HOUR]);
    });

    it("reports the daily limit once the day's views reach it", async () => {
      expect(
        await stats.record([entry({ page: "/", count: 2 })], {
          dailyLimit: 3,
          today: TODAY,
        }),
      ).toEqual({ limitReached: false });
      expect(
        await stats.record([entry({ page: "/" })], {
          dailyLimit: 3,
          today: TODAY,
        }),
      ).toEqual({ limitReached: true });
      expect(
        await stats.record([entry({ page: "/" })], {
          dailyLimit: 0,
          today: TODAY,
        }),
      ).toEqual({ limitReached: false });
    });

    it("does nothing with an empty batch", async () => {
      await expect(
        stats.record([], { dailyLimit: 1, today: TODAY }),
      ).resolves.toEqual({ limitReached: false });
      expect(await rowCount()).toBe(0);
    });
  });

  describe("reads", () => {
    it("fills the window day by day, oldest first", async () => {
      await stats.record(
        [
          entry({ page: "/", day: shiftDayKey(TODAY, -2), count: 4 }),
          entry({ page: "/", day: TODAY, count: 1 }),
          // Outside the window.
          entry({ page: "/", day: shiftDayKey(TODAY, -3), count: 9 }),
        ],
        { dailyLimit: 0, today: TODAY },
      );

      const overview = await stats.getOverview({
        days: 3,
        today: TODAY,
        hour: `${TODAY}T12`,
      });
      expect(overview).toMatchObject({
        days: 3,
        since: shiftDayKey(TODAY, -2),
        until: TODAY,
        total: 5,
      });
      expect(overview.series).toEqual({
        unit: "day",
        points: [
          { at: shiftDayKey(TODAY, -2), views: 4 },
          { at: shiftDayKey(TODAY, -1), views: 0 },
          { at: TODAY, views: 1 },
        ],
      });
    });

    it("draws today by the hour, up to the current one", async () => {
      const yesterday = shiftDayKey(TODAY, -1);
      await stats.record(
        [
          entry({ page: "/", hour: `${TODAY}T09`, count: 2 }),
          entry({ page: "/", hour: `${TODAY}T09`, referrer: "a.b" }),
          entry({ page: "/", hour: `${TODAY}T11`, count: 5 }),
          // Yesterday's hours are not today's.
          entry({
            page: "/",
            day: yesterday,
            hour: `${yesterday}T23`,
            count: 7,
          }),
        ],
        { dailyLimit: 0, today: TODAY },
      );

      const overview = await stats.getOverview({
        days: 1,
        today: TODAY,
        hour: `${TODAY}T11`,
      });
      expect(overview.total).toBe(8);
      expect(overview.series.unit).toBe("hour");
      expect(overview.series.points).toHaveLength(12);
      expect(overview.series.points[9]).toEqual({
        at: `${TODAY}T09`,
        views: 3,
      });
      expect(overview.series.points[10]).toEqual({
        at: `${TODAY}T10`,
        views: 0,
      });
      expect(overview.series.points[11]).toEqual({
        at: `${TODAY}T11`,
        views: 5,
      });
      // The day table holds the same views, folded by page and referrer.
      expect(await rowCount()).toBe(3);
    });

    it("keeps a page's today to its total and sources, without hours", async () => {
      const post = await posts.create({
        format: "note",
        title: "Read me",
        bodyMarkdown: "Body",
        status: "published",
      });
      await stats.record([entry({ page: post.id, count: 2 })], {
        dailyLimit: 0,
        today: TODAY,
      });

      const detail = await stats.getPage(post.id, {
        days: 1,
        today: TODAY,
        hour: HOUR,
      });
      expect(detail?.total).toBe(2);
      expect(detail?.series).toBeNull();
    });

    it("keeps internal navigation apart from direct visits", async () => {
      await stats.record(
        [
          entry({ page: "/", count: 4 }),
          entry({ page: "/", referrer: VIEW_INTERNAL_REFERRER, count: 9 }),
          entry({ page: "/", referrer: "a.b", count: 1 }),
        ],
        { dailyLimit: 0, today: TODAY },
      );

      const { referrers } = await stats.getOverview({
        days: 7,
        today: TODAY,
        hour: HOUR,
      });
      expect(referrers).toEqual({
        direct: 4,
        internal: 9,
        top: [{ host: "a.b", views: 1 }],
        other: 0,
      });
    });

    it("lists the most-viewed pages of every kind, each named", async () => {
      const titled = await posts.create({
        format: "note",
        title: "Hello",
        bodyMarkdown: "Body",
        status: "published",
      });
      const untitled = await posts.create({
        format: "note",
        bodyMarkdown: "A note with no title is named by its opening words.",
        status: "published",
      });
      const reading = await collections.create({
        slug: "reading",
        title: "Reading",
      });
      const quotes = await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
        selection: { format: "quote" },
      });
      await stats.record(
        [
          entry({ page: titled.id, count: 2 }),
          entry({ page: titled.id, referrer: "a.b", count: 2 }),
          entry({ page: untitled.id, count: 5 }),
          entry({ page: reading.id, count: 3 }),
          entry({ page: quotes.id, count: 1 }),
          entry({ page: "/", count: 7 }),
          entry({ page: "/archive", count: 6 }),
          // A deleted post leaves its rows behind until the sweep; the list
          // still accounts for them.
          entry({ page: GONE_POST, count: 9 }),
          // The overflow row is a remainder, not a page.
          entry({
            page: VIEW_OVERFLOW_KEY,
            referrer: VIEW_OVERFLOW_KEY,
            count: 9,
          }),
        ],
        { dailyLimit: 0, today: TODAY },
      );

      const overview = await stats.getOverview({
        days: 7,
        today: TODAY,
        hour: `${TODAY}T12`,
      });
      expect(overview.total).toBe(44);
      expect(overview.pages).toEqual([
        { kind: "post", key: GONE_POST, post: null, views: 9 },
        { kind: "path", key: "/", views: 7 },
        { kind: "path", key: "/archive", views: 6 },
        {
          kind: "post",
          key: untitled.id,
          post: {
            title: "A note with no title is named by its opening words.",
            slug: untitled.slug,
            format: "note",
          },
          views: 5,
        },
        {
          kind: "post",
          key: titled.id,
          post: { title: "Hello", slug: titled.slug, format: "note" },
          views: 4,
        },
        {
          kind: "collection",
          key: reading.id,
          collection: { title: "Reading", slug: "reading" },
          views: 3,
        },
        {
          kind: "collection",
          key: quotes.id,
          collection: { title: "Quotes", slug: "quotes" },
          views: 1,
        },
      ]);
    });

    it("keeps the ten busiest referrers and sums the rest", async () => {
      const hosts = Array.from({ length: 12 }, (_, index) => `h${index}.test`);
      await stats.record(
        [
          entry({ page: "/", referrer: "", count: 100 }),
          ...hosts.map((host, index) =>
            entry({ page: "/", referrer: host, count: 20 - index }),
          ),
          entry({
            page: VIEW_OVERFLOW_KEY,
            referrer: VIEW_OVERFLOW_KEY,
            count: 3,
          }),
        ],
        { dailyLimit: 0, today: TODAY },
      );

      const { referrers } = await stats.getOverview({
        days: 1,
        today: TODAY,
        hour: `${TODAY}T12`,
      });
      expect(referrers.direct).toBe(100);
      expect(referrers.top.map((row) => row.host)).toEqual(hosts.slice(0, 10));
      expect(referrers.top[0]).toEqual({ host: "h0.test", views: 20 });
      // h10 (10) + h11 (9) + overflow (3).
      expect(referrers.other).toBe(22);
    });

    it("answers for one page by its key, and null for a key that names nothing", async () => {
      const post = await posts.create({
        format: "note",
        title: "Read me",
        bodyMarkdown: "Body",
        status: "published",
      });
      const reading = await collections.create({
        slug: "reading",
        title: "Reading",
      });
      await stats.record(
        [
          entry({ page: post.id, referrer: "news.ycombinator.com", count: 30 }),
          entry({ page: post.id, count: 4 }),
          entry({ page: reading.id, count: 2 }),
          entry({ page: "/", count: 50 }),
        ],
        { dailyLimit: 0, today: TODAY },
      );
      const window = { days: 7, today: TODAY, hour: `${TODAY}T12` };

      const detail = await stats.getPage(post.id, window);
      expect(detail).toMatchObject({
        page: {
          kind: "post",
          key: post.id,
          post: { title: "Read me", slug: post.slug, format: "note" },
        },
        total: 34,
        referrers: {
          direct: 4,
          top: [{ host: "news.ycombinator.com", views: 30 }],
          other: 0,
        },
      });
      expect(detail?.series?.points.at(-1)).toEqual({ at: TODAY, views: 34 });

      expect(await stats.getPage(reading.id, window)).toMatchObject({
        page: {
          kind: "collection",
          key: reading.id,
          collection: { title: "Reading", slug: "reading" },
        },
        total: 2,
      });
      expect(await stats.getPage("/", window)).toMatchObject({
        page: { kind: "path", key: "/" },
        total: 50,
      });

      // A page the site has is a page, with nothing counted in the window.
      const quiet = await posts.create({
        format: "note",
        title: "Quiet",
        bodyMarkdown: "Body",
        status: "published",
      });
      expect((await stats.getPage(quiet.id, window))?.total).toBe(0);

      // Nothing the site has, and nothing it ever counted.
      expect(await stats.getPage(GONE_POST, window)).toBeNull();
      expect(await stats.getPage("/nowhere", window)).toBeNull();
      expect(await stats.getPage("nonsense", window)).toBeNull();
      expect(await stats.getPage(VIEW_OVERFLOW_KEY, window)).toBeNull();
    });

    it("answers for one referrer by its key, ranking the pages it sent readers to", async () => {
      const post = await posts.create({
        format: "note",
        title: "Read me",
        bodyMarkdown: "Body",
        status: "published",
      });
      const reading = await collections.create({
        slug: "reading",
        title: "Reading",
      });
      await stats.record(
        [
          entry({ page: post.id, referrer: "news.ycombinator.com", count: 30 }),
          entry({
            page: reading.id,
            referrer: "news.ycombinator.com",
            count: 2,
          }),
          entry({ page: post.id, count: 4 }),
          entry({ page: "/", count: 50 }),
          entry({ page: "/", referrer: VIEW_INTERNAL_REFERRER, count: 7 }),
        ],
        { dailyLimit: 0, today: TODAY },
      );
      const window = { days: 7, today: TODAY };

      const fromHn = await stats.getReferrer("news.ycombinator.com", window);
      expect(fromHn).toMatchObject({
        referrer: "news.ycombinator.com",
        total: 32,
        pages: [
          { kind: "post", key: post.id, views: 30 },
          { kind: "collection", key: reading.id, views: 2 },
        ],
      });
      expect(fromHn?.series?.points.at(-1)).toEqual({ at: TODAY, views: 32 });

      // Direct and Internal are referrers too, by their stored keys.
      expect(await stats.getReferrer("", window)).toMatchObject({
        total: 54,
        pages: [
          { kind: "path", key: "/", views: 50 },
          { kind: "post", key: post.id, views: 4 },
        ],
      });
      expect(
        await stats.getReferrer(VIEW_INTERNAL_REFERRER, window),
      ).toMatchObject({
        total: 7,
        pages: [{ kind: "path", key: "/", views: 7 }],
      });

      // A referrer has no hours of its own: today is its total and its pages.
      const today = await stats.getReferrer("news.ycombinator.com", {
        days: 1,
        today: TODAY,
      });
      expect(today?.total).toBe(32);
      expect(today?.series).toBeNull();

      // Nothing the site ever counted a view from, and the overflow row.
      expect(await stats.getReferrer("reddit.com", window)).toBeNull();
      expect(await stats.getReferrer(VIEW_OVERFLOW_KEY, window)).toBeNull();
    });

    it("keeps a referrer whose views fall outside the window", async () => {
      await stats.record(
        [
          entry({
            page: "/",
            referrer: "bing.com",
            day: shiftDayKey(TODAY, -10),
            count: 3,
          }),
        ],
        { dailyLimit: 0, today: TODAY },
      );

      const week = await stats.getReferrer("bing.com", {
        days: 7,
        today: TODAY,
      });
      expect(week).toMatchObject({ referrer: "bing.com", total: 0, pages: [] });
      // Direct exists before anything direct was counted.
      expect(
        await stats.getReferrer("", { days: 7, today: TODAY }),
      ).toMatchObject({ total: 0, pages: [] });
    });

    it("keeps a deleted post's page while its rows last", async () => {
      const post = await posts.create({
        format: "note",
        title: "Gone soon",
        bodyMarkdown: "Body",
        status: "published",
      });
      await stats.record([entry({ page: post.id, count: 3 })], {
        dailyLimit: 0,
        today: TODAY,
      });
      await posts.delete(post.id);

      expect(
        await stats.getPage(post.id, {
          days: 7,
          today: TODAY,
          hour: `${TODAY}T12`,
        }),
      ).toMatchObject({
        page: { kind: "post", key: post.id, post: null },
        total: 3,
      });
    });
  });

  describe("the start of the record", () => {
    it("is stamped by the first flush with the batch's earliest day", async () => {
      const earlier = shiftDayKey(TODAY, -2);
      await stats.record(
        [entry({ page: "/" }), entry({ page: "/a", day: earlier })],
        { dailyLimit: 0, today: TODAY },
      );
      expect(await settings.get("STATS_SINCE")).toBe(earlier);

      // A later batch does not move it, whatever days it carries.
      await stats.record([entry({ page: "/", day: shiftDayKey(TODAY, -5) })], {
        dailyLimit: 0,
        today: TODAY,
      });
      expect(await settings.get("STATS_SINCE")).toBe(earlier);
    });

    it("is today for a site looked at before anything was counted", async () => {
      const overview = await stats.getOverview({
        days: 7,
        today: TODAY,
        hour: `${TODAY}T12`,
      });
      expect(overview.start).toBe(TODAY);
      expect(overview.total).toBe(0);
      expect(await settings.get("STATS_SINCE")).toBe(TODAY);

      const tomorrow = shiftDayKey(TODAY, 1);
      await stats.record([entry({ page: "/", day: tomorrow })], {
        dailyLimit: 0,
        today: tomorrow,
      });
      expect(await settings.get("STATS_SINCE")).toBe(TODAY);
      expect(
        (
          await stats.getOverview({
            days: 7,
            today: tomorrow,
            hour: `${tomorrow}T12`,
          })
        ).start,
      ).toBe(TODAY);
    });

    it("is reported only while it falls inside the window", async () => {
      const began = shiftDayKey(TODAY, -3);
      await settings.set("STATS_SINCE", began);

      expect(
        (
          await stats.getOverview({
            days: 7,
            today: TODAY,
            hour: `${TODAY}T12`,
          })
        ).start,
      ).toBe(began);
      // The window begins on the same day: every day of it was counted.
      expect(
        (
          await stats.getOverview({
            days: 4,
            today: TODAY,
            hour: `${TODAY}T12`,
          })
        ).start,
      ).toBeNull();
      expect(
        (
          await stats.getOverview({
            days: 3,
            today: TODAY,
            hour: `${TODAY}T12`,
          })
        ).start,
      ).toBeNull();
    });

    it("moves back to a counted day that predates it", async () => {
      await settings.set("STATS_SINCE", TODAY);
      const yesterday = shiftDayKey(TODAY, -1);
      await stats.record([entry({ page: "/", day: yesterday })], {
        dailyLimit: 0,
        today: TODAY,
      });

      expect(
        (
          await stats.getOverview({
            days: 7,
            today: TODAY,
            hour: `${TODAY}T12`,
          })
        ).start,
      ).toBe(yesterday);
    });

    it("is the site's start on a post's own page", async () => {
      const post = await posts.create({
        format: "note",
        title: "Read me",
        bodyMarkdown: "Body",
        status: "published",
      });
      await settings.set("STATS_SINCE", shiftDayKey(TODAY, -3));
      await stats.record([entry({ page: post.id })], {
        dailyLimit: 0,
        today: TODAY,
      });

      const detail = await stats.getPage(post.id, {
        days: 7,
        today: TODAY,
        hour: `${TODAY}T12`,
      });
      expect(detail?.start).toBe(shiftDayKey(TODAY, -3));
    });
  });

  describe("the switch", () => {
    it("deletes the site's counts and its start on the way off", async () => {
      await stats.record([entry({ page: "/" })], {
        dailyLimit: 0,
        today: TODAY,
      });
      expect(await settings.get("STATS_SINCE")).toBe(TODAY);

      await stats.setEnabled(false, { today: TODAY });
      expect(await settings.get("STATS_ENABLED")).toBe("false");
      expect(await settings.get("STATS_SINCE")).toBeNull();
      expect(await rowCount()).toBe(0);
      expect(
        (await db.all(
          sql`SELECT count(*) AS total FROM view_hour WHERE site_id = ${SITE}`,
        )) as { total: number }[],
      ).toEqual([{ total: 0 }]);

      const later = shiftDayKey(TODAY, 10);
      await stats.setEnabled(true, { today: later });
      expect(await settings.get("STATS_ENABLED")).toBe("true");
      expect(await settings.get("STATS_SINCE")).toBe(later);
    });

    it("drops a flush that arrives after the switch was turned off", async () => {
      await stats.setEnabled(false, { today: TODAY });
      // Hits buffered before the switch reach the service after it.
      await expect(
        stats.record([entry({ page: "/" })], { dailyLimit: 3, today: TODAY }),
      ).resolves.toEqual({ limitReached: false });
      expect(await rowCount()).toBe(0);
      expect(await settings.get("STATS_SINCE")).toBeNull();
    });

    it("keeps an existing start when turned on again", async () => {
      await settings.set("STATS_SINCE", shiftDayKey(TODAY, -40));
      await stats.setEnabled(true, { today: TODAY });
      expect(await settings.get("STATS_SINCE")).toBe(shiftDayKey(TODAY, -40));
    });

    it("stamps the next flush after the counts were cleared", async () => {
      await stats.record([entry({ page: "/" })], {
        dailyLimit: 0,
        today: TODAY,
      });
      await stats.clear();
      expect(await settings.get("STATS_SINCE")).toBeNull();

      const later = shiftDayKey(TODAY, 3);
      await stats.record([entry({ page: "/", day: later })], {
        dailyLimit: 0,
        today: later,
      });
      expect(await settings.get("STATS_SINCE")).toBe(later);
    });
  });
});
