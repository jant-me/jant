/**
 * The Stats page and its switch, through the real services: the page shows
 * what the counters hold for the window asked for, says where its record
 * begins, any page in its list opens on its own, and the switch deletes the
 * counts on the way off.
 */

import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { settingsRoutes } from "../settings.js";
import type { ViewCountEntry } from "../../../lib/view-buffer.js";
import { shiftDayKey } from "../../../lib/view-counting.js";

const TODAY = new Date().toISOString().slice(0, 10);

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
    referrer: "",
    count: 1,
    ...overrides,
  };
}

/**
 * A post, a collection and the home page with views, and a record that
 * began long before any window, so the total line talks about the window.
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
      entry({ page: "/", count: 4 }),
      entry({ page: reading.id, count: 3 }),
    ],
    { dailyLimit: 0, today: TODAY },
  );
  return { post, reading };
}

describe("GET /settings/stats", () => {
  it("shows the window's total, the pages of every kind, and the referrers", async () => {
    const { app, services } = createApp();
    const { post, reading } = await seed(services);

    const res = await app.request("/settings/stats");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("50 views in the last 30 days");
    expect(html).toContain("A well-read note");
    expect(html).toContain(`/settings/stats?page=${post.id}&amp;days=30`);
    expect(html).toContain(">Home<");
    expect(html).toContain("/settings/stats?page=%2F&amp;days=30");
    expect(html).toContain(">Reading<");
    expect(html).toContain(`/settings/stats?page=${reading.id}&amp;days=30`);
    expect(html).toContain(">Collection<");
    expect(html).toContain("news.ycombinator.com");
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

    const html = await (await app.request("/settings/stats")).text();
    expect(html).toContain(`0 views since ${dayLabel(TODAY)}`);
    expect(html).toContain("settings-stats-axis-single");
    // Nothing to list: the total line has said so.
    expect(html).not.toContain("Referrers");
    expect(html).not.toContain(">Home<");
  });

  it("takes a window from ?days and ignores one it does not offer", async () => {
    const { app, services } = createApp();
    await seed(services);

    const week = await (await app.request("/settings/stats?days=7")).text();
    expect(week).toContain("50 views in the last 7 days");

    const odd = await (await app.request("/settings/stats?days=45")).text();
    expect(odd).toContain("50 views in the last 30 days");
  });

  it("opens one page of any kind, and answers 404 for a key that names nothing", async () => {
    const { app, services } = createApp();
    const { post, reading } = await seed(services);

    const res = await app.request(`/settings/stats?page=${post.id}`);
    expect(res.status).toBe(200);
    const postHtml = await res.text();
    expect(postHtml).toContain("43 views in the last 30 days");
    expect(postHtml).toContain("news.ycombinator.com");
    expect(postHtml).toContain(`href="/${post.slug}"`);
    // One page's numbers list no pages.
    expect(postHtml).not.toContain(">Home<");

    const home = await (await app.request("/settings/stats?page=%2F")).text();
    expect(home).toContain(">Home<");
    expect(home).toContain("4 views in the last 30 days");

    const collection = await (
      await app.request(`/settings/stats?page=${reading.id}`)
    ).text();
    expect(collection).toContain(">Reading<");
    expect(collection).toContain(">Collection<");
    expect(collection).toContain("3 views in the last 30 days");
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

  it("says so when stats are off", async () => {
    const { app, services } = createApp();
    await services.stats.setEnabled(false, { today: TODAY });

    const html = await (await app.request("/settings/stats")).text();
    expect(html).toContain("Stats are off.");
    expect(html).not.toContain("in the last 30 days");
  });
});

describe("POST /settings/stats", () => {
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
    expect(
      (await services.stats.getOverview({ days: 90, today: TODAY })).total,
    ).toBe(0);
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
    expect(
      (await services.stats.getOverview({ days: 90, today: TODAY })).total,
    ).toBe(50);
  });
});
