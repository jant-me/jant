/**
 * The Stats page and its switch, through the real services: the page opens
 * on today, shows what the counters hold for the window asked for, says
 * where its record begins, ranks what it lists, any page or referrer in its
 * lists opens on its own, and the switch deletes the counts on the way off.
 */

import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { settingsRoutes } from "../settings.js";
import type { ViewCountEntry } from "../../../lib/view-buffer.js";
import {
  shiftDayKey,
  VIEW_INTERNAL_REFERRER,
} from "../../../lib/view-counting.js";

const TODAY = new Date().toISOString().slice(0, 10);
const HOUR = `${TODAY}T00`;

/** `Nov 9` the way the page writes a day in English. */
function dayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1)));
}

function createApp(options: { demoMode?: boolean } = {}) {
  const test = createTestApp({
    authenticated: true,
    demoMode: options.demoMode,
  });
  test.app.route("/settings", settingsRoutes);
  return test;
}

function entry(
  overrides: Partial<ViewCountEntry> & { page: string },
): ViewCountEntry {
  return {
    siteId: "sit_test00000000000000000000000",
    day: TODAY,
    hour: HOUR,
    referrer: "",
    count: 1,
    ...overrides,
  };
}

/**
 * A post, a collection and the home page with views today, and a record
 * that began long before any window, so a longer window's total line talks
 * about the window. Fifty views: 43 of the post, 4 of the home page (two of
 * them from another page of the site), 3 of the collection.
 */
async function seed(
  services: ReturnType<typeof createApp>["services"],
  options: { since?: string } = {},
) {
  await services.settings.set(
    "STATS_SINCE",
    options.since ?? shiftDayKey(TODAY, -365),
  );
  const post = await services.posts.create({
    format: "note",
    title: "A well-read note",
    bodyMarkdown: "Body",
    status: "published",
  });
  const reading = await services.collections.create({
    slug: "reading",
    title: "Reading",
  });
  await services.stats.record(
    [
      entry({ page: post.id, referrer: "news.ycombinator.com", count: 41 }),
      entry({ page: post.id, count: 2 }),
      entry({ page: "/", count: 2 }),
      entry({ page: "/", referrer: VIEW_INTERNAL_REFERRER, count: 2 }),
      entry({ page: reading.id, count: 3 }),
    ],
    { dailyLimit: 0, today: TODAY },
  );
  return { post, reading };
}

describe("GET /settings/stats", () => {
  it("opens on today: the total, the hours, the ranked pages and referrers", async () => {
    const { app, services } = createApp();
    const { post, reading } = await seed(services);

    const res = await app.request("/settings/stats");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("50 views today");
    expect(html).toContain("Views per hour");
    // One slot per hour of the day; the one with views names its count for
    // the label a hovered slot shows.
    expect(html.match(/settings-stats-slot/g)).toHaveLength(24);
    expect(html).toContain('data-label="00:00: 50 views"');
    // The ranked list: the post first, with its share behind it.
    expect(html).toContain('settings-stats-rank">1<');
    expect(html).toContain("--stats-share:86%");
    expect(html).toContain("A well-read note");
    expect(html).toContain(`/settings/stats?page=${post.id}&amp;days=1`);
    expect(html).toContain(">Home<");
    expect(html).toContain(">Reading<");
    expect(html).toContain(`/settings/stats?page=${reading.id}&amp;days=1`);
    expect(html).toContain(">Collection<");
    // Referrers in order of size: the host, then direct, then internal.
    expect(html).toContain("news.ycombinator.com");
    expect(html.indexOf(">Direct<")).toBeLessThan(html.indexOf(">Internal<"));
    expect(html).toContain("Count page views");
  });

  it("says since when it has been counting while that day is in the window", async () => {
    const { app, services } = createApp();
    const began = shiftDayKey(TODAY, -2);
    await seed(services, { since: began });

    const week = await (await app.request("/settings/stats?days=7")).text();
    expect(week).toContain(`50 views since ${dayLabel(began)}`);
    // Four of the seven days were never counted: the baseline starts after
    // them, and the axis names today alone.
    expect(week).toContain(`style="--stats-start:${(4 / 7) * 100}%"`);
    expect(week).toContain("settings-stats-axis-single");
    expect(week).toContain(dayLabel(TODAY));
  });

  it("starts its record today when nothing was ever counted", async () => {
    const { app } = createApp();

    const today = await (await app.request("/settings/stats")).text();
    expect(today).toContain("0 views today");
    // Nothing to list: the total line has said so.
    expect(today).not.toContain("Referrers");
    expect(today).not.toContain(">Home<");

    const week = await (await app.request("/settings/stats?days=7")).text();
    expect(week).toContain(`0 views since ${dayLabel(TODAY)}`);
    expect(week).toContain("settings-stats-axis-single");
  });

  it("takes a window from ?days and ignores one it does not offer", async () => {
    const { app, services } = createApp();
    await seed(services);

    const week = await (await app.request("/settings/stats?days=7")).text();
    expect(week).toContain("50 views in the last 7 days");
    expect(week).toContain("Views per day");

    const month = await (await app.request("/settings/stats?days=30")).text();
    expect(month).toContain("50 views in the last 30 days");

    const odd = await (await app.request("/settings/stats?days=90")).text();
    expect(odd).toContain("50 views today");
  });

  it("opens one page of any kind, and answers 404 for a key that names nothing", async () => {
    const { app, services } = createApp();
    const { post, reading } = await seed(services);

    const res = await app.request(`/settings/stats?page=${post.id}`);
    expect(res.status).toBe(200);
    const postHtml = await res.text();
    expect(postHtml).toContain("43 views today");
    expect(postHtml).toContain("news.ycombinator.com");
    expect(postHtml).toContain(`href="/${post.slug}"`);
    // A page has no hours of its own, and one page's numbers list no pages.
    expect(postHtml).not.toContain("settings-stats-chart");
    expect(postHtml).not.toContain(">Home<");

    const month = await (
      await app.request(`/settings/stats?page=${post.id}&days=30`)
    ).text();
    expect(month).toContain("43 views in the last 30 days");
    expect(month).toContain("settings-stats-chart");

    const home = await (await app.request("/settings/stats?page=%2F")).text();
    expect(home).toContain(">Home<");
    expect(home).toContain("4 views today");
    expect(home).toContain(">Internal<");

    const collection = await (
      await app.request(`/settings/stats?page=${reading.id}`)
    ).text();
    expect(collection).toContain(">Reading<");
    expect(collection).toContain(">Collection<");
    expect(collection).toContain("3 views today");
    expect(collection).toContain('href="/reading"');

    for (const key of [
      "pst_00000000000000000000000001",
      "%2Fnowhere",
      "nonsense",
    ]) {
      const missing = await app.request(`/settings/stats?page=${key}`);
      expect(missing.status).toBe(404);
    }
  });

  it("opens one referrer with the pages it sent readers to, and answers 404 for one never seen", async () => {
    const { app, services } = createApp();
    const { post, reading } = await seed(services);

    // Every referrer row of the site's list is a link, Other apart.
    const overview = await (await app.request("/settings/stats")).text();
    expect(overview).toContain(
      'href="/settings/stats?referrer=news.ycombinator.com&amp;days=1"',
    );
    expect(overview).toContain('href="/settings/stats?referrer=&amp;days=1"');
    expect(overview).toContain(
      'href="/settings/stats?referrer=%2F&amp;days=1"',
    );
    // And so is every referrer row of one page's numbers.
    const postPage = await (
      await app.request(`/settings/stats?page=${post.id}&days=7`)
    ).text();
    expect(postPage).toContain(
      'href="/settings/stats?referrer=news.ycombinator.com&amp;days=7"',
    );

    const res = await app.request(
      "/settings/stats?referrer=news.ycombinator.com",
    );
    expect(res.status).toBe(200);
    const hn = await res.text();
    expect(hn).toContain("41 views today");
    expect(hn).toContain('settings-stats-rank">1<');
    expect(hn).toContain("A well-read note");
    expect(hn).toContain(`href="/settings/stats?page=${post.id}&amp;days=1"`);
    // The window switch stays on this referrer.
    expect(hn).toContain(
      'href="/settings/stats?referrer=news.ycombinator.com&amp;days=7"',
    );
    // A referrer has no hours of its own, and one referrer's numbers list no referrers.
    expect(hn).not.toContain("settings-stats-chart");
    expect(hn).not.toContain(">Referrers<");
    expect(hn).not.toContain("Count page views");

    const month = await (
      await app.request("/settings/stats?referrer=news.ycombinator.com&days=30")
    ).text();
    expect(month).toContain("41 views in the last 30 days");
    expect(month).toContain("settings-stats-chart");

    // Direct, by its empty key: the home page, the collection and the post.
    const direct = await (
      await app.request("/settings/stats?referrer=")
    ).text();
    expect(direct).toContain(">Direct<");
    expect(direct).toContain("7 views today");
    expect(direct).toContain(">Home<");
    expect(direct).toContain(">Reading<");
    expect(direct).toContain(
      `href="/settings/stats?page=${reading.id}&amp;days=1"`,
    );

    const internal = await (
      await app.request("/settings/stats?referrer=%2F")
    ).text();
    expect(internal).toContain(">Internal<");
    expect(internal).toContain("2 views today");
    expect(internal).toContain(">Home<");

    for (const key of ["reddit.com", "%2A"]) {
      const missing = await app.request(`/settings/stats?referrer=${key}`);
      expect(missing.status).toBe(404);
    }
  });

  it("says so when stats are off", async () => {
    const { app, services } = createApp();
    await services.stats.setEnabled(false, { today: TODAY });

    const html = await (await app.request("/settings/stats")).text();
    expect(html).toContain("Stats are off.");
    expect(html).not.toContain("views today");
  });
});

describe("POST /settings/stats", () => {
  const window = { days: 30, today: TODAY, hour: HOUR };

  it("turns counting off and deletes the counts", async () => {
    const { app, services } = createApp();
    await seed(services);

    const res = await app.request("/settings/stats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    expect(await services.settings.get("STATS_ENABLED")).toBe("false");
    expect(await services.settings.get("STATS_SINCE")).toBeNull();
    expect((await services.stats.getOverview(window)).total).toBe(0);
  });

  it("starts a new record when turned back on", async () => {
    const { app, services } = createApp();
    await services.stats.setEnabled(false, { today: TODAY });

    const res = await app.request("/settings/stats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    expect(await services.settings.get("STATS_ENABLED")).toBe("true");
    expect(await services.settings.get("STATS_SINCE")).toBe(TODAY);
  });

  it("refuses in demo mode", async () => {
    const { app, services } = createApp({ demoMode: true });
    await seed(services);

    const res = await app.request("/settings/stats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(403);
    expect((await services.stats.getOverview(window)).total).toBe(50);
  });
});
