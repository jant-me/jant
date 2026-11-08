import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import type { Database } from "../../db/index.js";
import { createPostService } from "../post.js";
import { createSettingsService } from "../settings.js";
import {
  createStatsService,
  createViewCountWriterState,
  VIEW_COUNT_RETENTION_DAYS,
} from "../stats.js";
import type { ViewCountEntry } from "../../lib/view-buffer.js";
import { shiftDayKey, VIEW_OVERFLOW_KEY } from "../../lib/view-counting.js";

const TODAY = "2026-11-08";
const SITE = DEFAULT_TEST_SITE_ID;

function entry(
  overrides: Partial<ViewCountEntry> & { page: string },
): ViewCountEntry {
  return {
    siteId: SITE,
    day: TODAY,
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

      const overview = await stats.getOverview({ days: 7, today: TODAY });
      expect(overview.total).toBe(6);
      expect(overview.referrers).toEqual({
        direct: 5,
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
      expect((await stats.getOverview({ days: 1, today: TODAY })).total).toBe(
        50,
      );
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
      expect((await capped.getOverview({ days: 1, today: TODAY })).total).toBe(
        20,
      );
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

      const overview = await stats.getOverview({ days: 3, today: TODAY });
      expect(overview).toMatchObject({
        days: 3,
        since: shiftDayKey(TODAY, -2),
        until: TODAY,
        total: 5,
      });
      expect(overview.series).toEqual([
        { day: shiftDayKey(TODAY, -2), views: 4 },
        { day: shiftDayKey(TODAY, -1), views: 0 },
        { day: TODAY, views: 1 },
      ]);
    });

    it("lists the most-viewed posts with their title and address", async () => {
      const titled = await posts.create({
        format: "note",
        title: "Hello",
        bodyMarkdown: "Body",
        status: "published",
      });
      const untitled = await posts.create({
        format: "note",
        bodyMarkdown: "A note with no title",
        status: "published",
      });
      await stats.record(
        [
          entry({ page: titled.id, count: 2 }),
          entry({ page: titled.id, referrer: "a.b", count: 2 }),
          entry({ page: untitled.id, count: 5 }),
          // A page that is not a post counts toward the total, not the list.
          entry({ page: "/", count: 7 }),
          // A post that no longer exists leaves its rows behind until the sweep.
          entry({ page: "pst_gone00000000000000000000000", count: 9 }),
        ],
        { dailyLimit: 0, today: TODAY },
      );

      const overview = await stats.getOverview({ days: 7, today: TODAY });
      expect(overview.total).toBe(25);
      expect(overview.pages).toEqual([{ path: "/", views: 7 }]);
      expect(overview.posts).toEqual([
        {
          id: untitled.id,
          title: null,
          slug: untitled.slug,
          format: "note",
          views: 5,
        },
        {
          id: titled.id,
          title: "Hello",
          slug: titled.slug,
          format: "note",
          views: 4,
        },
      ]);
    });

    it("lists the pages that are not posts by their path", async () => {
      await stats.record(
        [
          entry({ page: "/", count: 7 }),
          entry({ page: "/archive", count: 3 }),
          entry({ page: "/archive", referrer: "a.b", count: 1 }),
          entry({ page: "/collections/a+b", count: 1 }),
          entry({ page: "/featured", count: 1 }),
          // Post ids and the overflow row are not pages.
          entry({ page: "pst_gone00000000000000000000000", count: 9 }),
          entry({
            page: VIEW_OVERFLOW_KEY,
            referrer: VIEW_OVERFLOW_KEY,
            count: 9,
          }),
        ],
        { dailyLimit: 0, today: TODAY },
      );

      const { pages } = await stats.getOverview({ days: 7, today: TODAY });
      expect(pages).toEqual([
        { path: "/", views: 7 },
        { path: "/archive", views: 4 },
        { path: "/collections/a+b", views: 1 },
        { path: "/featured", views: 1 },
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

      const { referrers } = await stats.getOverview({ days: 1, today: TODAY });
      expect(referrers.direct).toBe(100);
      expect(referrers.top.map((row) => row.host)).toEqual(hosts.slice(0, 10));
      expect(referrers.top[0]).toEqual({ host: "h0.test", views: 20 });
      // h10 (10) + h11 (9) + overflow (3).
      expect(referrers.other).toBe(22);
    });

    it("answers for one post, or null for a post the site does not have", async () => {
      const post = await posts.create({
        format: "note",
        title: "Read me",
        bodyMarkdown: "Body",
        status: "published",
      });
      await stats.record(
        [
          entry({ page: post.id, referrer: "news.ycombinator.com", count: 30 }),
          entry({ page: post.id, count: 4 }),
          entry({ page: "/", count: 50 }),
        ],
        { dailyLimit: 0, today: TODAY },
      );

      const detail = await stats.getPost(post.id, { days: 7, today: TODAY });
      expect(detail).toMatchObject({
        post: {
          id: post.id,
          title: "Read me",
          slug: post.slug,
          format: "note",
        },
        total: 34,
        referrers: {
          direct: 4,
          top: [{ host: "news.ycombinator.com", views: 30 }],
          other: 0,
        },
      });
      expect(detail?.series.at(-1)).toEqual({ day: TODAY, views: 34 });

      expect(
        await stats.getPost("pst_missing0000000000000000000", {
          days: 7,
          today: TODAY,
        }),
      ).toBeNull();
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
      const overview = await stats.getOverview({ days: 7, today: TODAY });
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
        (await stats.getOverview({ days: 7, today: tomorrow })).start,
      ).toBe(TODAY);
    });

    it("is reported only while it falls inside the window", async () => {
      const began = shiftDayKey(TODAY, -3);
      await settings.set("STATS_SINCE", began);

      expect((await stats.getOverview({ days: 7, today: TODAY })).start).toBe(
        began,
      );
      // The window begins on the same day: every day of it was counted.
      expect(
        (await stats.getOverview({ days: 4, today: TODAY })).start,
      ).toBeNull();
      expect(
        (await stats.getOverview({ days: 3, today: TODAY })).start,
      ).toBeNull();
    });

    it("moves back to a counted day that predates it", async () => {
      await settings.set("STATS_SINCE", TODAY);
      const yesterday = shiftDayKey(TODAY, -1);
      await stats.record([entry({ page: "/", day: yesterday })], {
        dailyLimit: 0,
        today: TODAY,
      });

      expect((await stats.getOverview({ days: 7, today: TODAY })).start).toBe(
        yesterday,
      );
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

      const detail = await stats.getPost(post.id, { days: 7, today: TODAY });
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

      const later = shiftDayKey(TODAY, 10);
      await stats.setEnabled(true, { today: later });
      expect(await settings.get("STATS_ENABLED")).toBe("true");
      expect(await settings.get("STATS_SINCE")).toBe(later);
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
