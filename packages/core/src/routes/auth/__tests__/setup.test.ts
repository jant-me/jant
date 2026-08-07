import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/helpers/db.js";
import { sql } from "drizzle-orm";
import { navItems, settings, siteDomains, sites } from "../../../db/schema.js";
import { createBootstrapService } from "../../../services/bootstrap.js";
import type { Database } from "../../../db/index.js";
import type { BootstrapService } from "../../../services/bootstrap.js";

/**
 * Reproduces the shell bootstrap logic from POST /setup to verify
 * setup stays idempotent even when managed shell data already exists.
 */
async function runSetupBootstrap(
  services: { bootstrap: BootstrapService },
  overrides: Partial<
    Parameters<BootstrapService["completeInitialSetup"]>[0]
  > = {},
) {
  await services.bootstrap.completeInitialSetup({
    ownerUserId: "usr_test-owner",
    siteName: "Jant Demo",
    ...overrides,
  });
}

describe("Setup bootstrap logic", () => {
  let services: {
    bootstrap: BootstrapService;
    db: Database;
  };

  beforeEach(() => {
    const testDb = createTestDatabase();
    const db = testDb.db as unknown as Database;
    services = {
      db,
      bootstrap: createBootstrapService(db),
    };
  });

  it("creates the five-item default navigation without Latest", async () => {
    await runSetupBootstrap(services);

    const navItemsList = await services.db.select().from(navItems);
    expect(navItemsList).toHaveLength(5);

    expect(navItemsList.map((item) => item.systemKey)).toEqual([
      "featured",
      "collections",
      "archive",
      "rss",
      "settings",
    ]);
  });

  it("marks onboarding complete", async () => {
    await runSetupBootstrap(services);

    const rows = await services.db.select().from(settings);
    const onboardingRow = rows.find((row) => row.key === "ONBOARDING_STATUS");
    expect(onboardingRow?.value).toBe("completed");
  });

  it("stores the chosen content language and timezone during setup", async () => {
    await runSetupBootstrap(services, {
      siteLanguage: "en",
      timeZone: "Asia/Shanghai",
    });

    const rows = await services.db.select().from(settings);
    expect(rows.find((row) => row.key === "SITE_LANGUAGE")?.value).toBe("en");
    expect(rows.find((row) => row.key === "TIME_ZONE")?.value).toBe(
      "Asia/Shanghai",
    );
  });

  it("pins the dashboard language to the browser, not the site", async () => {
    // Someone running an English blog from a Chinese browser: English site,
    // Chinese dashboard.
    await runSetupBootstrap(services, {
      siteLanguage: "en",
      browserLanguage: "zh-TW",
    });

    const rows = await services.db.select().from(settings);
    expect(rows.find((row) => row.key === "SITE_LANGUAGE")?.value).toBe("en");
    expect(rows.find((row) => row.key === "DASHBOARD_LANGUAGE")?.value).toBe(
      "zh-Hant",
    );
  });

  it("falls back to the content language when the browser sent none", async () => {
    await runSetupBootstrap(services, { siteLanguage: "zh-TW" });

    const rows = await services.db.select().from(settings);
    // Content language stays verbatim; the dashboard locale is the resolved
    // catalog (zh-Hant) so it is stable if content language later changes.
    expect(rows.find((row) => row.key === "SITE_LANGUAGE")?.value).toBe(
      "zh-TW",
    );
    expect(rows.find((row) => row.key === "DASHBOARD_LANGUAGE")?.value).toBe(
      "zh-Hant",
    );
  });

  it("is idempotent when default navigation already exists", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    await services.db.run(sql`
      INSERT INTO "nav_item" (
        "id",
        "site_id",
        "type",
        "system_key",
        "label",
        "url",
        "position",
        "created_at",
        "updated_at"
      )
      VALUES (
        'nav_test-existing',
        'sit_test00000000000000000000000',
        'system',
        'collections',
        'Collections',
        '/collections',
        'a0',
        ${timestamp},
        ${timestamp}
      )
    `);

    await runSetupBootstrap(services);

    const navItemsList = await services.db.select().from(navItems);
    const systemItems = navItemsList.filter((item) => item.type === "system");

    expect(systemItems).toHaveLength(5);
    expect(systemItems.map((item) => item.systemKey)).not.toContain("latest");
    expect(
      systemItems.find((item) => item.systemKey === "collections")?.label,
    ).toBe("Collections");
  });

  it("creates a site shell when setup runs after a factory reset", async () => {
    await services.db.run(sql`DELETE FROM "site_domain"`);
    await services.db.run(sql`DELETE FROM "site"`);

    await runSetupBootstrap(services);

    const siteRows = await services.db.select().from(sites);
    const domainRows = await services.db.select().from(siteDomains);
    expect(siteRows).toHaveLength(1);
    expect(domainRows).toHaveLength(0);
  });
});
