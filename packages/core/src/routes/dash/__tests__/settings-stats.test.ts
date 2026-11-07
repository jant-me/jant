/**
 * The Stats page and its switch, through the real services: the page shows
 * what the counters hold for the window asked for, one post can be opened on
 * its own, and the switch deletes the counts on the way off.
 */

import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { settingsRoutes } from "../settings.js";
import type { ViewCountEntry } from "../../../lib/view-buffer.js";

const TODAY = new Date().toISOString().slice(0, 10);

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

async function seed(services: ReturnType<typeof createApp>["services"]) {
  const post = await services.posts.create({
    format: "note",
    title: "A well-read note",
    bodyMarkdown: "Body",
    status: "published",
  });
  await services.stats.record(
    [
      entry({ page: post.id, referrer: "news.ycombinator.com", count: 41 }),
      entry({ page: post.id, count: 2 }),
      entry({ page: "/", count: 7 }),
    ],
    { dailyLimit: 0, today: TODAY },
  );
  return post;
}

describe("GET /settings/stats", () => {
  it("shows the window's total, the posts, and the referrers", async () => {
    const { app, services } = createApp();
    const post = await seed(services);

    const res = await app.request("/settings/stats");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("50 views in the last 30 days");
    expect(html).toContain("A well-read note");
    expect(html).toContain(`/settings/stats?post=${post.id}&amp;days=30`);
    expect(html).toContain("news.ycombinator.com");
    expect(html).toContain("Count page views");
  });

  it("takes a window from ?days and ignores one it does not offer", async () => {
    const { app, services } = createApp();
    await seed(services);

    const week = await (await app.request("/settings/stats?days=7")).text();
    expect(week).toContain("50 views in the last 7 days");

    const odd = await (await app.request("/settings/stats?days=45")).text();
    expect(odd).toContain("50 views in the last 30 days");
  });

  it("opens one post, and answers 404 for a post the site does not have", async () => {
    const { app, services } = createApp();
    const post = await seed(services);

    const res = await app.request(`/settings/stats?post=${post.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("43 views in the last 30 days");
    expect(html).toContain("news.ycombinator.com");
    expect(html).toContain(`href="/${post.slug}"`);

    const missing = await app.request(
      "/settings/stats?post=pst_missing0000000000000000000",
    );
    expect(missing.status).toBe(404);
  });

  it("says so when stats are off", async () => {
    const { app, services } = createApp();
    await services.stats.setEnabled(false);

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
    expect(
      (await services.stats.getOverview({ days: 90, today: TODAY })).total,
    ).toBe(0);
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
