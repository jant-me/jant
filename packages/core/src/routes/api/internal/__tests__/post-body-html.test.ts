import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestApp } from "../../../../__tests__/helpers/app.js";
import { posts, sites } from "../../../../db/schema.js";
import { POST_BODY_HTML_VERSION } from "../../../../lib/post-body-html.js";
import { createPostService } from "../../../../services/post.js";
import { internalPostBodyHtmlRoutes } from "../post-body-html.js";
import { internalSitesRoutes } from "../sites.js";

describe("Internal post body HTML rebuild routes", () => {
  it("hides the current-site endpoint when no internal token is configured", async () => {
    const { app } = createTestApp({ authenticated: false });
    app.route("/api/internal/posts/body-html", internalPostBodyHtmlRoutes);

    const response = await app.request(
      "/api/internal/posts/body-html/rebuild",
      { method: "POST" },
    );

    expect(response.status).toBe(404);
  });

  it("dry-runs and rebuilds the current site", async () => {
    const { app, services, db } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
    });
    app.use("*", async (c, next) => {
      c.set("appConfig", undefined as never);
      await next();
    });
    app.route("/api/internal/posts/body-html", internalPostBodyHtmlRoutes);
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Body[^1]\n\n[^1]: Definition",
    });
    await db
      .update(posts)
      .set({
        bodyHtml: '<span class="sidenote">legacy</span>',
        bodyHtmlVersion: 1,
      })
      .where(eq(posts.id, post.id));

    const dryRun = await app.request("/api/internal/posts/body-html/rebuild", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ dryRun: true, limit: 25 }),
    });
    expect(dryRun.status).toBe(200);
    await expect(dryRun.json()).resolves.toMatchObject({
      processed: 1,
      wouldRebuild: 1,
      rebuilt: 0,
      targetVersion: POST_BODY_HTML_VERSION,
    });

    const rebuild = await app.request("/api/internal/posts/body-html/rebuild", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit: 25 }),
    });
    expect(rebuild.status).toBe(200);
    await expect(rebuild.json()).resolves.toMatchObject({
      rebuilt: 1,
      failed: 0,
    });
  });

  it("rebuilds only the explicitly selected managed site", async () => {
    const { app, services, db } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.use("*", async (c, next) => {
      c.set("appConfig", undefined as never);
      await next();
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const timestamp = Math.floor(Date.now() / 1000);
    const secondSiteId = "sit_managed00000000000000000000";
    await db.insert(sites).values({
      id: secondSiteId,
      key: "managed",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const defaultPost = await services.posts.create({
      format: "note",
      bodyMarkdown: "Default",
    });
    const managedService = createPostService(
      db,
      { slugIdLength: 5 },
      secondSiteId,
    );
    const managedPost = await managedService.create({
      format: "note",
      bodyMarkdown: "Managed[^1]\n\n[^1]: Definition",
    });
    await db
      .update(posts)
      .set({ bodyHtmlVersion: 1 })
      .where(eq(posts.id, defaultPost.id));
    await db
      .update(posts)
      .set({ bodyHtmlVersion: 1 })
      .where(eq(posts.id, managedPost.id));

    const response = await app.request(
      `/api/internal/sites/${secondSiteId}/posts/body-html/rebuild`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer internal-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      processed: 1,
      rebuilt: 1,
    });

    const rows = await db
      .select({ id: posts.id, version: posts.bodyHtmlVersion })
      .from(posts);
    expect(rows.find((row) => row.id === managedPost.id)?.version).toBe(
      POST_BODY_HTML_VERSION,
    );
    expect(rows.find((row) => row.id === defaultPost.id)?.version).toBe(1);
  });

  it("rejects an unknown explicit site instead of reporting an empty success", async () => {
    const { app } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const response = await app.request(
      "/api/internal/sites/sit_missing/posts/body-html/rebuild",
      {
        method: "POST",
        headers: { Authorization: "Bearer internal-secret" },
      },
    );

    expect(response.status).toBe(404);
  });
});
