import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDatabase } from "../../../__tests__/helpers/db.js";
import { sql } from "drizzle-orm";
import { navItems, settings, siteDomains, sites } from "../../../db/schema.js";
import { createBootstrapService } from "../../../services/bootstrap.js";
import type { Database } from "../../../db/index.js";
import type { BootstrapService } from "../../../services/bootstrap.js";

/**
 * Reproduces both halves of POST /setup back to back — the shape a self-hosted
 * install ends up in — to verify setup stays idempotent even when managed shell
 * data already exists.
 */
async function runSetupBootstrap(
  services: { bootstrap: BootstrapService },
  overrides: Partial<Parameters<BootstrapService["completeSiteSetup"]>[0]> = {},
) {
  await services.bootstrap.provisionOwnerAccount({
    ownerUserId: "usr_test-owner",
  });
  await services.bootstrap.completeSiteSetup(
    { siteName: "Jant Demo", ...overrides },
    { oldLanguage: "" },
  );
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
      "archive",
      "collections",
      "subscribe",
      "settings",
    ]);
  });

  it("marks onboarding complete", async () => {
    await runSetupBootstrap(services);

    const rows = await services.db.select().from(settings);
    const onboardingRow = rows.find((row) => row.key === "ONBOARDING_STATUS");
    expect(onboardingRow?.value).toBe("completed");
  });

  // The state the site rests in between the two setup screens. It has to be
  // `provisioned` and not `pending`: that is what lets an author who lost the
  // session in between sign back in and finish, rather than being bounced back
  // to a form that would try to create their account a second time.
  it("leaves the site provisioned and unnamed after the account step", async () => {
    await services.bootstrap.provisionOwnerAccount({
      ownerUserId: "usr_test-owner",
    });

    const rows = await services.db.select().from(settings);
    expect(rows.find((row) => row.key === "ONBOARDING_STATUS")?.value).toBe(
      "provisioned",
    );
    expect(rows.find((row) => row.key === "SITE_NAME")).toBeUndefined();

    const navItemsList = await services.db.select().from(navItems);
    expect(navItemsList).toHaveLength(5);
  });

  // The hosted path through the same method: the control plane named the site
  // at creation, and the author answering the last screen must not blank it.
  it("leaves an existing name alone when the last screen asked for none", async () => {
    await runSetupBootstrap(services);
    await services.bootstrap.completeSiteSetup(
      { siteLanguage: "en" },
      { oldLanguage: "en" },
    );

    const rows = await services.db.select().from(settings);
    expect(rows.find((row) => row.key === "SITE_NAME")?.value).toBe(
      "Jant Demo",
    );
  });

  it("renames the operator's account to match the site", async () => {
    const updateCurrentUserName = vi.fn(async () => undefined);

    await services.bootstrap.provisionOwnerAccount({
      ownerUserId: "usr_test-owner",
    });
    await services.bootstrap.completeSiteSetup(
      { siteName: "  Jant Demo  " },
      { oldLanguage: "" },
      { updateCurrentUserName },
    );

    expect(updateCurrentUserName).toHaveBeenCalledWith("Jant Demo");
  });

  // The rename runs before onboarding closes, so a better-auth failure leaves
  // the author on the screen they were already on instead of inside a finished
  // site under a stale account name.
  it("leaves setup open when the account rename fails", async () => {
    await services.bootstrap.provisionOwnerAccount({
      ownerUserId: "usr_test-owner",
    });
    await expect(
      services.bootstrap.completeSiteSetup(
        { siteName: "Jant Demo" },
        { oldLanguage: "" },
        {
          updateCurrentUserName: async () => {
            throw new Error("better-auth unavailable");
          },
        },
      ),
    ).rejects.toThrow("better-auth unavailable");

    const rows = await services.db.select().from(settings);
    expect(rows.find((row) => row.key === "ONBOARDING_STATUS")?.value).toBe(
      "provisioned",
    );
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

  it("pins the dashboard language when only the browser knows it", async () => {
    // Someone running an English blog from a Chinese browser: English site,
    // Chinese dashboard. Following the content language would miss this.
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

  it("leaves the dashboard following a content language the author chose", async () => {
    // The reverse mismatch, and the common one: an English browser is what
    // every unconfigured machine reports, so it is no evidence against the
    // language just chosen by hand. The dashboard must not freeze to English.
    await runSetupBootstrap(services, {
      siteLanguage: "zh-Hans",
      browserLanguage: "en",
    });

    const rows = await services.db.select().from(settings);
    expect(rows.find((row) => row.key === "SITE_LANGUAGE")?.value).toBe(
      "zh-Hans",
    );
    expect(
      rows.find((row) => row.key === "DASHBOARD_LANGUAGE"),
    ).toBeUndefined();
  });

  it("leaves the dashboard following when the browser sent none", async () => {
    await runSetupBootstrap(services, { siteLanguage: "zh-TW" });

    const rows = await services.db.select().from(settings);
    // Content language stays verbatim, and the dashboard derives zh-Hant from
    // it at render time rather than being pinned here.
    expect(rows.find((row) => row.key === "SITE_LANGUAGE")?.value).toBe(
      "zh-TW",
    );
    expect(
      rows.find((row) => row.key === "DASHBOARD_LANGUAGE"),
    ).toBeUndefined();
  });

  it("leaves the dashboard following when browser and content agree", async () => {
    await runSetupBootstrap(services, {
      siteLanguage: "zh-Hans",
      browserLanguage: "zh-CN",
    });

    const rows = await services.db.select().from(settings);
    expect(
      rows.find((row) => row.key === "DASHBOARD_LANGUAGE"),
    ).toBeUndefined();
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
