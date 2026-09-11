import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../../__tests__/helpers/db.js";
import { eq, sql } from "drizzle-orm";
import {
  navItems,
  settings,
  siteDomains,
  siteMembers,
  sites,
} from "../../../db/schema.js";
import { createBootstrapService } from "../../../services/bootstrap.js";
import {
  createSiteService,
  TRANSIENT_SINGLE_SITE_ID,
} from "../../../services/site.js";
import type { Database } from "../../../db/index.js";
import type { BootstrapService } from "../../../services/bootstrap.js";

/**
 * The bootstrap service one self-hosted setup request gets: bound to the site
 * that request resolved, the way the runtime binds it. Resolved afresh for
 * each screen, because the account step is what creates the site the second
 * screen finds.
 */
async function bootstrapForRequest(db: Database): Promise<BootstrapService> {
  const { site } = await createSiteService(db).resolveSingleSite();
  return createBootstrapService(db, site.id);
}

/**
 * Reproduces both halves of POST /setup back to back — the shape a self-hosted
 * install ends up in — to verify setup stays idempotent even when managed shell
 * data already exists.
 */
async function runSetupBootstrap(
  services: { db: Database },
  overrides: Partial<Parameters<BootstrapService["completeSiteSetup"]>[0]> = {},
) {
  await (
    await bootstrapForRequest(services.db)
  ).provisionOwnerAccount({
    ownerUserId: "usr_test-owner",
  });
  await (
    await bootstrapForRequest(services.db)
  ).completeSiteSetup(
    { siteName: "Jant Demo", ...overrides },
    { oldLanguage: "" },
  );
}

/** Adds a second tenant, which is what a hosted database always has. */
async function insertOtherSite(
  db: Database,
  id = "sit_other00000000000000000000",
) {
  const timestamp = Math.floor(Date.now() / 1000);
  await db.insert(sites).values({
    id,
    key: "other",
    status: "active",
    createdAt: timestamp - 60,
    updatedAt: timestamp - 60,
  });
  return id;
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
      // The site both screens resolve once its row exists.
      bootstrap: createBootstrapService(db, DEFAULT_TEST_SITE_ID),
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

    const rows = await services.db.select().from(settings);
    expect(rows.find((row) => row.key === "SITE_NAME")?.siteId).toBe(
      siteRows[0]?.id,
    );
  });

  // Settings written under the placeholder would belong to no site at all.
  it("refuses to finish a site the account step has not created", async () => {
    await services.db.run(sql`DELETE FROM "site"`);

    await expect(
      createBootstrapService(
        services.db,
        TRANSIENT_SINGLE_SITE_ID,
      ).completeSiteSetup({ siteName: "Jant Demo" }, { oldLanguage: "" }),
    ).rejects.toThrow("completeSiteSetup needs an existing site");

    expect(await services.db.select().from(settings)).toHaveLength(0);
  });
});

// A hosted database holds every tenant, so "the only site" has no answer there.
// Setup must write to the site the request's host resolved — the one the
// route's membership check just read — and leave every other tenant alone.
describe("Setup bootstrap on a host-based install", () => {
  function createHostedServices() {
    const { services, db } = createTestApp({
      siteResolutionMode: "host-based",
    });
    return { services, db };
  }

  it("finishes the request's site while other sites share the database", async () => {
    const { services, db } = createHostedServices();
    const otherSiteId = await insertOtherSite(db);

    await services.bootstrap.completeSiteSetup(
      { siteLanguage: "en" },
      { oldLanguage: "" },
    );

    const rows = await db.select().from(settings);
    expect(
      rows.find(
        (row) =>
          row.siteId === DEFAULT_TEST_SITE_ID &&
          row.key === "ONBOARDING_STATUS",
      )?.value,
    ).toBe("completed");
    expect(rows.filter((row) => row.siteId === otherSiteId)).toHaveLength(0);
  });

  it("attaches the owner to the request's site and creates none", async () => {
    const { services, db } = createHostedServices();
    const otherSiteId = await insertOtherSite(db);

    await services.bootstrap.provisionOwnerAccount({
      ownerUserId: "usr_test-owner",
    });

    expect(await db.select().from(sites)).toHaveLength(2);
    const members = await db
      .select()
      .from(siteMembers)
      .where(eq(siteMembers.userId, "usr_test-owner"));
    expect(members.map((member) => [member.siteId, member.role])).toEqual([
      [DEFAULT_TEST_SITE_ID, "owner"],
    ]);
    const navRows = await db.select().from(navItems);
    expect(navRows.length).toBeGreaterThan(0);
    expect(navRows.every((row) => row.siteId === DEFAULT_TEST_SITE_ID)).toBe(
      true,
    );
    const settingRows = await db.select().from(settings);
    expect(
      settingRows.filter((row) => row.siteId === otherSiteId),
    ).toHaveLength(0);
  });

  // The control plane creates hosted sites. Materializing one here would add a
  // stray tenant to a database that holds real ones.
  it("never creates a site when the request resolved none", async () => {
    const db = createTestDatabase().db as unknown as Database;
    await db.run(sql`DELETE FROM "site"`);

    await expect(
      createBootstrapService(db, TRANSIENT_SINGLE_SITE_ID, {
        siteResolutionMode: "host-based",
      }).provisionOwnerAccount({ ownerUserId: "usr_test-owner" }),
    ).rejects.toThrow("provisionOwnerAccount needs an existing site");

    expect(await db.select().from(sites)).toHaveLength(0);
  });
});
