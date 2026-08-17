import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../../__tests__/helpers/db.js";
import { sqliteSchemaBundle } from "../../db/schema-bundle.js";
import { ConflictError } from "../../lib/errors.js";
import { createSiteAdminService } from "../site-admin.js";

describe("SiteAdminService", () => {
  it("rejects managed site creation in single-site mode", async () => {
    const { db } = createTestDatabase();
    const service = createSiteAdminService(db, sqliteSchemaBundle, "sqlite", {
      siteResolutionMode: "single-site",
    });

    await expect(
      service.createManagedSite({
        key: "demo-cloud",
        primaryHost: "demo-cloud.example.com",
        siteName: "Demo Cloud",
      }),
    ).rejects.toEqual(
      new ConflictError(
        "Managed site operations are only available in host-based mode.",
      ),
    );
  });

  it("creates managed sites in host-based mode", async () => {
    const { db, sqlite } = createTestDatabase();
    const service = createSiteAdminService(db, sqliteSchemaBundle, "sqlite", {
      siteResolutionMode: "host-based",
    });

    const created = await service.createManagedSite({
      key: "demo-cloud",
      primaryHost: "demo-cloud.example.com",
      siteName: "Demo Cloud",
    });

    expect(created.site.id).toMatch(/^sit_/);
    expect(created.domain.host).toBe("demo-cloud.example.com");

    const siteRows = sqlite
      .prepare('SELECT "key" FROM "site" WHERE "id" = ?')
      .all(created.site.id) as { key: string }[];

    expect(siteRows).toEqual([{ key: "demo-cloud" }]);

    const navigationRows = sqlite
      .prepare(
        'SELECT "system_key" AS systemKey, "placement" FROM "nav_item" WHERE "site_id" = ? ORDER BY "position"',
      )
      .all(created.site.id) as { systemKey: string; placement: string }[];

    expect(navigationRows).toEqual([
      { systemKey: "featured", placement: "header" },
      { systemKey: "archive", placement: "header" },
      { systemKey: "collections", placement: "more" },
      { systemKey: "rss", placement: "more" },
      { systemKey: "settings", placement: "more" },
    ]);
  });

  it("preserves valid browser timezones during managed site creation", async () => {
    const { db, sqlite } = createTestDatabase();
    const service = createSiteAdminService(db, sqliteSchemaBundle, "sqlite", {
      siteResolutionMode: "host-based",
    });

    const created = await service.createManagedSite({
      key: "timezone-site",
      primaryHost: "timezone-site.example.com",
      siteName: "Timezone Site",
      timeZone: "Etc/GMT-8",
    });

    const timeZone = sqlite
      .prepare(
        'SELECT "value" FROM "site_setting" WHERE "site_id" = ? AND "key" = \'TIME_ZONE\'',
      )
      .get(created.site.id) as { value: string } | undefined;

    expect(timeZone?.value).toBe("Etc/GMT-8");
  });

  it("falls back to UTC when optional provisioning timezone metadata is invalid", async () => {
    const { db, sqlite } = createTestDatabase();
    const service = createSiteAdminService(db, sqliteSchemaBundle, "sqlite", {
      siteResolutionMode: "host-based",
    });

    const created = await service.createManagedSite({
      key: "fallback-site",
      primaryHost: "fallback-site.example.com",
      siteName: "Fallback Site",
      timeZone: "Unknown/Zone",
    });

    const timeZone = sqlite
      .prepare(
        'SELECT "value" FROM "site_setting" WHERE "site_id" = ? AND "key" = \'TIME_ZONE\'',
      )
      .get(created.site.id) as { value: string } | undefined;

    expect(timeZone).toBeUndefined();
  });

  it("returns the existing site when replayed with the same idempotency key", async () => {
    const { db, sqlite } = createTestDatabase();
    const service = createSiteAdminService(db, sqliteSchemaBundle, "sqlite", {
      siteResolutionMode: "host-based",
    });

    const first = await service.createManagedSite({
      key: "idem-site",
      primaryHost: "idem-site.example.com",
      siteName: "Idempotent Site",
      idempotencyKey: "job_abc",
    });

    sqlite
      .prepare(
        'DELETE FROM "nav_item" WHERE "site_id" = ? AND "system_key" = \'featured\'',
      )
      .run(first.site.id);

    const second = await service.createManagedSite({
      key: "idem-site",
      primaryHost: "idem-site.example.com",
      siteName: "Idempotent Site",
      idempotencyKey: "job_abc",
    });

    expect(second.site.id).toBe(first.site.id);
    expect(second.domain.id).toBe(first.domain.id);
    const featuredCount = sqlite
      .prepare(
        'SELECT COUNT(*) AS count FROM "nav_item" WHERE "site_id" = ? AND "system_key" = \'featured\'',
      )
      .get(first.site.id) as { count: number };
    expect(featuredCount.count).toBe(0);
  });

  it("recovers an incomplete idempotent provisioning attempt", async () => {
    const { db, sqlite } = createTestDatabase();
    const service = createSiteAdminService(db, sqliteSchemaBundle, "sqlite", {
      siteResolutionMode: "host-based",
    });

    const first = await service.createManagedSite({
      key: "recovery-site",
      primaryHost: "recovery-site.example.com",
      siteName: "Recovery Site",
      idempotencyKey: "job_recovery",
    });
    sqlite
      .prepare('DELETE FROM "nav_item" WHERE "site_id" = ?')
      .run(first.site.id);
    sqlite
      .prepare(
        'DELETE FROM "site_setting" WHERE "site_id" = ? AND "key" = \'ONBOARDING_STATUS\'',
      )
      .run(first.site.id);

    const recovered = await service.createManagedSite({
      key: "recovery-site",
      primaryHost: "recovery-site.example.com",
      siteName: "Recovery Site",
      idempotencyKey: "job_recovery",
    });

    const navigationRows = sqlite
      .prepare(
        'SELECT "system_key" AS systemKey FROM "nav_item" WHERE "site_id" = ? ORDER BY "position"',
      )
      .all(first.site.id) as { systemKey: string }[];
    const onboarding = sqlite
      .prepare(
        'SELECT "value" FROM "site_setting" WHERE "site_id" = ? AND "key" = \'ONBOARDING_STATUS\'',
      )
      .get(first.site.id) as { value: string };

    expect(recovered.site.id).toBe(first.site.id);
    expect(navigationRows.map((row) => row.systemKey)).toEqual([
      "featured",
      "archive",
      "collections",
      "rss",
      "settings",
    ]);
    expect(onboarding.value).toBe("provisioned");
  });

  it("rejects reuse of an idempotency key with different key or primary host", async () => {
    const { db } = createTestDatabase();
    const service = createSiteAdminService(db, sqliteSchemaBundle, "sqlite", {
      siteResolutionMode: "host-based",
    });

    await service.createManagedSite({
      key: "idem-site",
      primaryHost: "idem-site.example.com",
      siteName: "Idempotent Site",
      idempotencyKey: "job_xyz",
    });

    await expect(
      service.createManagedSite({
        key: "other-site",
        primaryHost: "idem-site.example.com",
        siteName: "Other Site",
        idempotencyKey: "job_xyz",
      }),
    ).rejects.toEqual(
      new ConflictError(
        "Idempotency key was reused with a different site key or primary host.",
      ),
    );

    await expect(
      service.createManagedSite({
        key: "idem-site",
        primaryHost: "different-host.example.com",
        siteName: "Idempotent Site",
        idempotencyKey: "job_xyz",
      }),
    ).rejects.toEqual(
      new ConflictError(
        "Idempotency key was reused with a different site key or primary host.",
      ),
    );
  });

  it("treats requests without an idempotency key as independent creations", async () => {
    const { db } = createTestDatabase();
    const service = createSiteAdminService(db, sqliteSchemaBundle, "sqlite", {
      siteResolutionMode: "host-based",
    });

    await service.createManagedSite({
      key: "no-idem-site",
      primaryHost: "no-idem-site.example.com",
      siteName: "No Idem Site",
    });

    await expect(
      service.createManagedSite({
        key: "no-idem-site",
        primaryHost: "no-idem-site-2.example.com",
        siteName: "No Idem Site",
      }),
    ).rejects.toEqual(new ConflictError("Site key is already in use."));
  });
});
