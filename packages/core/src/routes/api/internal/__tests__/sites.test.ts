import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { createTestApp } from "../../../../__tests__/helpers/app.js";
import { DEFAULT_TEST_SITE_ID } from "../../../../__tests__/helpers/db.js";
import { internalSitesRoutes } from "../sites.js";

describe("Internal site admin routes", () => {
  it("returns 404 when the internal admin token is not configured", async () => {
    const { app } = createTestApp({ authenticated: false });
    app.route("/api/internal/sites", internalSitesRoutes);

    const res = await app.request("/api/internal/sites", {
      method: "POST",
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: "Internal admin endpoint not found",
      code: "NOT_FOUND",
    });
  });

  it("rejects site provisioning in single-site mode", async () => {
    const { app } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "single-site",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const res = await app.request("/api/internal/sites", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "demo-cloud",
        primaryHost: "demo-cloud.example.com",
        siteName: "Demo Cloud",
      }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Site provisioning is only available in host-based mode.",
      code: "CONFLICT",
    });
  });

  it("creates a managed site in host-based mode", async () => {
    const { app, sqlite } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const res = await app.request("/api/internal/sites", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "demo-cloud",
        primaryHost: "demo-cloud.example.com",
        siteName: "Demo Cloud",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      primaryHost: string;
      siteId: string;
      status: string;
    };

    expect(body.primaryHost).toBe("demo-cloud.example.com");
    expect(body.siteId).toMatch(/^sit_/);
    expect(body.status).toBe("active");

    const siteRows = sqlite
      .prepare('SELECT "key" FROM "site" WHERE "id" = ?')
      .all(body.siteId) as { key: string }[];
    const domainRows = sqlite
      .prepare('SELECT "host" FROM "site_domain" WHERE "site_id" = ?')
      .all(body.siteId) as { host: string }[];
    const settingRows = sqlite
      .prepare(
        'SELECT "key", "value" FROM "site_setting" WHERE "site_id" = ? ORDER BY "key" ASC',
      )
      .all(body.siteId) as { key: string; value: string }[];

    expect(siteRows).toEqual([{ key: "demo-cloud" }]);
    expect(domainRows).toEqual([{ host: "demo-cloud.example.com" }]);
    // Provisioned, not completed: the site is real and servable, but its
    // owner has not yet confirmed the language they write in.
    expect(settingRows).toEqual([
      { key: "ONBOARDING_STATUS", value: "provisioned" },
      { key: "SITE_LANGUAGE", value: "en" },
      { key: "SITE_NAME", value: "Demo Cloud" },
    ]);
  });

  it("stores locale defaults passed by the control plane", async () => {
    const { app, sqlite } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const res = await app.request("/api/internal/sites", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "locale-demo",
        primaryHost: "locale-demo.example.com",
        siteName: "Locale Demo",
        siteLanguage: "en-US",
        timeZone: "Etc/GMT-8",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      siteId: string;
    };

    const settingRows = sqlite
      .prepare(
        'SELECT "key", "value" FROM "site_setting" WHERE "site_id" = ? ORDER BY "key" ASC',
      )
      .all(body.siteId) as { key: string; value: string }[];

    expect(settingRows).toEqual([
      { key: "ONBOARDING_STATUS", value: "provisioned" },
      { key: "SITE_LANGUAGE", value: "en" },
      { key: "SITE_NAME", value: "Locale Demo" },
      { key: "TIME_ZONE", value: "Etc/GMT-8" },
    ]);
  });

  it("falls back to UTC instead of rejecting invalid browser timezone metadata", async () => {
    const { app, sqlite } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const res = await app.request("/api/internal/sites", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "timezone-fallback",
        primaryHost: "timezone-fallback.example.com",
        siteName: "Timezone Fallback",
        timeZone: "Unknown/Zone",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { siteId: string };
    const timeZone = sqlite
      .prepare(
        'SELECT "value" FROM "site_setting" WHERE "site_id" = ? AND "key" = \'TIME_ZONE\'',
      )
      .get(body.siteId);

    expect(timeZone).toBeUndefined();
  });

  it("reports an unused key as available", async () => {
    const { app } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const res = await app.request(
      "/api/internal/sites/availability?key=Fresh-Key",
      {
        headers: { Authorization: "Bearer internal-secret" },
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true, key: "fresh-key" });
  });

  it("reports an existing key as unavailable", async () => {
    const { app } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const createRes = await app.request("/api/internal/sites", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "taken-key",
        primaryHost: "taken-key.example.com",
        siteName: "Taken Key",
      }),
    });
    expect(createRes.status).toBe(201);

    const res = await app.request(
      "/api/internal/sites/availability?key=taken-key",
      {
        headers: { Authorization: "Bearer internal-secret" },
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false, key: "taken-key" });
  });

  it("rejects availability checks without an admin token", async () => {
    const { app } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const res = await app.request(
      "/api/internal/sites/availability?key=any-key",
    );

    expect(res.status).toBe(401);
  });

  it("rejects availability checks with an invalid key", async () => {
    const { app } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const res = await app.request("/api/internal/sites/availability?key=ab", {
      headers: { Authorization: "Bearer internal-secret" },
    });

    expect(res.status).toBe(400);
  });

  it("returns managed site media usage in host-based mode", async () => {
    const { app, services } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    await services.media.create({
      filename: "first.jpg",
      mimeType: "image/jpeg",
      originalName: "first.jpg",
      size: 1024,
      storageKey: "media/default/files/first.jpg",
    });
    await services.media.create({
      filename: "second.jpg",
      mimeType: "image/jpeg",
      originalName: "second.jpg",
      size: 2048,
      storageKey: "media/default/files/second.jpg",
    });

    const res = await app.request(
      `/api/internal/sites/${DEFAULT_TEST_SITE_ID}/media-usage`,
      {
        headers: {
          Authorization: "Bearer internal-secret",
        },
      },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      mediaBytesUsed: 3072,
      siteId: DEFAULT_TEST_SITE_ID,
    });
  });

  it("returns published post counts for hosted sites", async () => {
    const { app, sqlite } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const insertPost = sqlite.prepare(
      `INSERT INTO "post" ("id", "site_id", "format", "status", "thread_id", "created_at", "updated_at")
       VALUES (?, ?, 'note', ?, ?, 1774200002, 1774200002)`,
    );
    insertPost.run(
      "pst_count_1",
      DEFAULT_TEST_SITE_ID,
      "published",
      "pst_count_1",
    );
    insertPost.run(
      "pst_count_2",
      DEFAULT_TEST_SITE_ID,
      "published",
      "pst_count_2",
    );
    insertPost.run("pst_count_3", DEFAULT_TEST_SITE_ID, "draft", "pst_count_3");

    const res = await app.request("/api/internal/sites/post-counts", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        siteIds: [DEFAULT_TEST_SITE_ID, "sit_does_not_exist"],
      }),
    });

    expect(res.status).toBe(200);
    // Drafts are excluded, and an unknown site id resolves to 0 rather than
    // failing the whole batch.
    await expect(res.json()).resolves.toEqual({
      counts: [
        { publishedPostCount: 2, siteId: DEFAULT_TEST_SITE_ID },
        { publishedPostCount: 0, siteId: "sit_does_not_exist" },
      ],
    });
  });

  it("rejects post-count lookups without an admin token", async () => {
    const { app } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const res = await app.request("/api/internal/sites/post-counts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteIds: [DEFAULT_TEST_SITE_ID] }),
    });

    expect(res.status).toBe(401);
  });

  it("deletes a managed site without clearing other sites", async () => {
    const { app, sqlite } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const createRes = await app.request("/api/internal/sites", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "delete-demo",
        primaryHost: "delete-demo.example.com",
        siteName: "Delete Demo",
      }),
    });

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { siteId: string };
    const siteId = created.siteId;

    sqlite
      .prepare(
        `INSERT INTO "site_member" ("site_id", "user_id", "role", "created_at", "updated_at")
         VALUES (?, 'member_1', 'owner', 1774200001, 1774200001)`,
      )
      .run(siteId);
    sqlite
      .prepare(
        `INSERT INTO "post" ("id", "site_id", "format", "thread_id", "created_at", "updated_at")
         VALUES ('pst_delete_1', ?, 'note', 'pst_delete_1', 1774200002, 1774200002)`,
      )
      .run(siteId);
    sqlite
      .prepare(
        `INSERT INTO "site_setting" ("site_id", "key", "value", "updated_at")
         VALUES (?, 'SITE_AVATAR', 'sites/${siteId}/avatar.webp', 1774200003)`,
      )
      .run(siteId);
    // A smart collection filtering by a collection on the same site. The pair
    // is the shape this endpoint used to die on: the condition column once
    // carried `ON DELETE restrict`, so clearing `collection` threw partway
    // through a delete that runs without a transaction on SQLite and D1.
    sqlite
      .prepare(
        `INSERT INTO "collection" ("id", "site_id", "title", "sort_order", "created_at", "updated_at")
         VALUES ('col_delete_1', ?, 'Notes', 'newest', 1774200004, 1774200004)`,
      )
      .run(siteId);
    sqlite
      .prepare(
        `INSERT INTO "smart_collection" ("id", "site_id", "title", "collection_id", "format", "sort", "created_at", "updated_at")
         VALUES ('smc_delete_1', ?, 'Untitled notes', 'col_delete_1', 'note', 'newest', 1774200005, 1774200005)`,
      )
      .run(siteId);
    sqlite
      .prepare(
        `INSERT INTO "path_registry" ("id", "site_id", "path", "kind", "smart_collection_id", "created_at", "updated_at")
         VALUES ('pth_delete_1', ?, 'untitled-notes', 'slug', 'smc_delete_1', 1774200006, 1774200006)`,
      )
      .run(siteId);

    const deleteRes = await app.request(`/api/internal/sites/${siteId}`, {
      method: "DELETE",
      headers: {
        Authorization: "Bearer internal-secret",
      },
    });

    expect(deleteRes.status).toBe(204);

    const deletedSiteCount = sqlite
      .prepare('SELECT COUNT(*) AS count FROM "site" WHERE "id" = ?')
      .get(siteId) as { count: number };
    const deletedDomainCount = sqlite
      .prepare(
        'SELECT COUNT(*) AS count FROM "site_domain" WHERE "site_id" = ?',
      )
      .get(siteId) as { count: number };
    const deletedMemberCount = sqlite
      .prepare(
        'SELECT COUNT(*) AS count FROM "site_member" WHERE "site_id" = ?',
      )
      .get(siteId) as { count: number };
    const deletedPostCount = sqlite
      .prepare('SELECT COUNT(*) AS count FROM "post" WHERE "site_id" = ?')
      .get(siteId) as { count: number };
    const deletedSettingsCount = sqlite
      .prepare(
        'SELECT COUNT(*) AS count FROM "site_setting" WHERE "site_id" = ?',
      )
      .get(siteId) as { count: number };
    const deletedCollectionCount = sqlite
      .prepare('SELECT COUNT(*) AS count FROM "collection" WHERE "site_id" = ?')
      .get(siteId) as { count: number };
    const deletedSmartCollectionCount = sqlite
      .prepare(
        'SELECT COUNT(*) AS count FROM "smart_collection" WHERE "site_id" = ?',
      )
      .get(siteId) as { count: number };
    const deletedPathCount = sqlite
      .prepare(
        'SELECT COUNT(*) AS count FROM "path_registry" WHERE "site_id" = ?',
      )
      .get(siteId) as { count: number };
    const defaultSiteCount = sqlite
      .prepare('SELECT COUNT(*) AS count FROM "site" WHERE "id" = ?')
      .get(DEFAULT_TEST_SITE_ID) as { count: number };

    expect(deletedSiteCount.count).toBe(0);
    expect(deletedDomainCount.count).toBe(0);
    expect(deletedMemberCount.count).toBe(0);
    expect(deletedPostCount.count).toBe(0);
    expect(deletedSettingsCount.count).toBe(0);
    expect(deletedCollectionCount.count).toBe(0);
    expect(deletedSmartCollectionCount.count).toBe(0);
    expect(deletedPathCount.count).toBe(0);
    expect(defaultSiteCount.count).toBe(1);
  });

  it("exports a managed site as a raw site archive", async () => {
    const { app } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const createRes = await app.request("/api/internal/sites", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "export-demo",
        primaryHost: "export-demo.example.com",
        siteName: "Export Demo",
      }),
    });

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { siteId: string };

    const exportRes = await app.request(
      `/api/internal/sites/${created.siteId}/export`,
      {
        headers: {
          Authorization: "Bearer internal-secret",
        },
      },
    );

    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("content-type")).toBe("application/zip");
    expect(exportRes.headers.get("content-disposition")).toContain(
      'attachment; filename="export-demo-site-export.zip"',
    );

    const files = unzipSync(new Uint8Array(await exportRes.arrayBuffer()));
    const configToml = new TextDecoder().decode(files["hugo.toml"]);

    expect(configToml).toContain(
      'baseURL = "https://export-demo.example.com/"',
    );
    expect(configToml).toContain('title = "Export Demo"');
  });

  it("suspends and resumes a managed site", async () => {
    const { app, sqlite } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const createRes = await app.request("/api/internal/sites", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "suspend-demo",
        primaryHost: "suspend-demo.example.com",
        siteName: "Suspend Demo",
      }),
    });

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { siteId: string };

    const suspendRes = await app.request(
      `/api/internal/sites/${created.siteId}/suspend`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer internal-secret",
        },
      },
    );

    expect(suspendRes.status).toBe(200);
    expect(await suspendRes.json()).toEqual({
      siteId: created.siteId,
      status: "suspended",
    });

    const suspendedSite = sqlite
      .prepare('SELECT "status" FROM "site" WHERE "id" = ?')
      .get(created.siteId) as { status: string };
    expect(suspendedSite.status).toBe("suspended");

    const resumeRes = await app.request(
      `/api/internal/sites/${created.siteId}/resume`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer internal-secret",
        },
      },
    );

    expect(resumeRes.status).toBe(200);
    expect(await resumeRes.json()).toEqual({
      siteId: created.siteId,
      status: "active",
    });

    const resumedSite = sqlite
      .prepare('SELECT "status" FROM "site" WHERE "id" = ?')
      .get(created.siteId) as { status: string };
    expect(resumedSite.status).toBe("active");
  });

  it("manages site domains for a hosted site", async () => {
    const { app } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const createRes = await app.request("/api/internal/sites", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "domain-demo",
        primaryHost: "domain-demo.example.com",
        siteName: "Domain Demo",
      }),
    });

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { siteId: string };

    const addRes = await app.request(
      `/api/internal/sites/${created.siteId}/domains`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer internal-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          host: "www.domain-demo.example.com",
          makePrimary: false,
        }),
      },
    );

    expect(addRes.status).toBe(201);
    const addedBody = (await addRes.json()) as {
      domains: Array<{ host: string; id: string; kind: string }>;
    };
    expect(addedBody.domains.map((domain) => domain.host)).toEqual([
      "domain-demo.example.com",
      "www.domain-demo.example.com",
    ]);
    expect(addedBody.domains[1]?.kind).toBe("alias");

    const aliasId = addedBody.domains[1]?.id;
    expect(aliasId).toBeTruthy();

    const setPrimaryRes = await app.request(
      `/api/internal/sites/${created.siteId}/domains/${aliasId}/primary`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer internal-secret",
        },
      },
    );

    expect(setPrimaryRes.status).toBe(200);
    const primaryBody = (await setPrimaryRes.json()) as {
      domains: Array<{
        host: string;
        id: string;
        kind: string;
        redirectToPrimary: boolean;
      }>;
    };
    expect(primaryBody.domains).toEqual([
      {
        host: "www.domain-demo.example.com",
        id: aliasId,
        kind: "primary",
        redirectToPrimary: true,
      },
      {
        host: "domain-demo.example.com",
        id: expect.any(String),
        kind: "alias",
        redirectToPrimary: true,
      },
    ]);

    const removeRes = await app.request(
      `/api/internal/sites/${created.siteId}/domains/${aliasId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: "Bearer internal-secret",
        },
      },
    );

    expect(removeRes.status).toBe(409);
    expect(await removeRes.json()).toEqual({
      error: "Set another primary domain before removing this one.",
      code: "CONFLICT",
    });

    const listRes = await app.request(
      `/api/internal/sites/${created.siteId}/domains`,
      {
        headers: {
          Authorization: "Bearer internal-secret",
        },
      },
    );

    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({
      domains: [
        {
          host: "www.domain-demo.example.com",
          id: aliasId,
          kind: "primary",
          redirectToPrimary: true,
        },
        {
          host: "domain-demo.example.com",
          id: expect.any(String),
          kind: "alias",
          redirectToPrimary: true,
        },
      ],
    });
  });

  it("leaves the demoted alias serving directly when adding a new primary", async () => {
    const { app } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      siteResolutionMode: "host-based",
    });
    app.route("/api/internal/sites", internalSitesRoutes);

    const createRes = await app.request("/api/internal/sites", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "redirect-demo",
        primaryHost: "redirect-demo.jant.blog",
        siteName: "Redirect Demo",
      }),
    });

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { siteId: string };

    const addRes = await app.request(
      `/api/internal/sites/${created.siteId}/domains`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer internal-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          host: "blog.example.com",
          makePrimary: true,
        }),
      },
    );

    expect(addRes.status).toBe(201);
    const addedBody = (await addRes.json()) as {
      domains: Array<{
        host: string;
        id: string;
        kind: string;
        redirectToPrimary: boolean;
      }>;
    };
    const newPrimary = addedBody.domains.find(
      (domain) => domain.host === "blog.example.com",
    );
    const demotedAlias = addedBody.domains.find(
      (domain) => domain.host === "redirect-demo.jant.blog",
    );
    expect(newPrimary?.kind).toBe("primary");
    expect(demotedAlias?.kind).toBe("alias");
    // The demoted managed host must keep serving its own content while the
    // newly-added custom primary's DNS is still propagating.
    expect(demotedAlias?.redirectToPrimary).toBe(false);

    const flipRes = await app.request(
      `/api/internal/sites/${created.siteId}/domains/${demotedAlias?.id}/redirect`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer internal-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ redirectToPrimary: true }),
      },
    );

    expect(flipRes.status).toBe(200);
    const flipBody = (await flipRes.json()) as {
      domains: Array<{
        host: string;
        id: string;
        redirectToPrimary: boolean;
      }>;
    };
    const aliasAfterFlip = flipBody.domains.find(
      (domain) => domain.id === demotedAlias?.id,
    );
    expect(aliasAfterFlip?.redirectToPrimary).toBe(true);
  });
});
