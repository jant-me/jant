import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../../__tests__/helpers/db.js";
import type { Database } from "../../db/index.js";
import {
  account,
  navItems,
  settings,
  siteDomains,
  siteMembers,
  sites,
  user,
} from "../../db/schema.js";
import { verifyPassword } from "../../lib/password.js";
import { createBootstrapService } from "../bootstrap.js";
import { createSiteService, TRANSIENT_SINGLE_SITE_ID } from "../site.js";

const SNAPSHOT_SITE_ID = "sit_01kn8jq3t4famtyg9hjd074ckr";
const OWNER = { email: "owner@example.com", password: "correct horse" };

async function readSettings(db: Database, siteId: string) {
  const rows = await db.select().from(settings);
  return Object.fromEntries(
    rows
      .filter((row) => row.siteId === siteId)
      .map((row) => [row.key, row.value]),
  );
}

async function storedPasswordHash(db: Database) {
  const rows = await db.select({ password: account.password }).from(account);
  expect(rows).toHaveLength(1);
  return rows[0]?.password ?? "";
}

describe("EnsureSingleSiteOptions.id", () => {
  let db: Database;

  beforeEach(async () => {
    db = createTestDatabase().db as unknown as Database;
    await db.run(sql`DELETE FROM "site"`);
  });

  it("creates the site with the given id", async () => {
    const { site } = await createSiteService(db).ensureSingleSite({
      id: SNAPSHOT_SITE_ID,
    });

    expect(site.id).toBe(SNAPSHOT_SITE_ID);
  });

  // Like the host and key, the id says what a new site is created with. It is
  // never a request to rename a site that exists.
  it("leaves an existing site's id alone", async () => {
    const { site: existing } = await createSiteService(db).ensureSingleSite();
    const { site } = await createSiteService(db).ensureSingleSite({
      id: SNAPSHOT_SITE_ID,
    });

    expect(site.id).toBe(existing.id);
    expect(await db.select().from(sites)).toHaveLength(1);
  });
});

describe("BootstrapService.setUpInstance", () => {
  let db: Database;

  function bootstrap(options?: Parameters<typeof createBootstrapService>[2]) {
    return createBootstrapService(db, TRANSIENT_SINGLE_SITE_ID, options);
  }

  beforeEach(async () => {
    db = createTestDatabase().db as unknown as Database;
    await db.run(sql`DELETE FROM "site"`);
  });

  it("leaves a fresh install set up, the way both screens would", async () => {
    const result = await bootstrap().setUpInstance({
      ...OWNER,
      siteId: SNAPSHOT_SITE_ID,
      siteName: "Field Notes",
      siteLanguage: "zh-Hans",
      timeZone: "Asia/Shanghai",
    });

    expect(result).toEqual({ outcome: "created", siteId: SNAPSHOT_SITE_ID });

    const [owner] = await db.select().from(user);
    expect(owner).toMatchObject({
      email: OWNER.email,
      name: "Field Notes",
      role: "admin",
    });
    expect(
      await verifyPassword({
        hash: await storedPasswordHash(db),
        password: OWNER.password,
      }),
    ).toBe(true);

    expect(await db.select().from(siteMembers)).toEqual([
      expect.objectContaining({
        siteId: SNAPSHOT_SITE_ID,
        userId: owner?.id,
        role: "owner",
      }),
    ]);
    expect(await db.select().from(navItems)).toHaveLength(5);
    expect(await readSettings(db, SNAPSHOT_SITE_ID)).toMatchObject({
      ONBOARDING_STATUS: "completed",
      SITE_NAME: "Field Notes",
      SITE_LANGUAGE: "zh-Hans",
      TIME_ZONE: "Asia/Shanghai",
    });
  });

  // An empty answer on the screens: the base locale and UTC, and no name, so
  // the site keeps its fallback and the account keeps the address's stand-in.
  it("gives unanswered questions the screens' defaults", async () => {
    const result = await bootstrap().setUpInstance(OWNER);

    expect(result.outcome).toBe("created");
    expect(result.siteId).toMatch(/^sit_/);
    const stored = await readSettings(db, result.siteId);
    expect(stored).toMatchObject({
      ONBOARDING_STATUS: "completed",
      SITE_LANGUAGE: "en",
      TIME_ZONE: "UTC",
    });
    expect(stored.SITE_NAME).toBeUndefined();
    expect((await db.select().from(user))[0]?.name).toBe("owner");
  });

  it("gives the site its configured domain", async () => {
    await createBootstrapService(db, TRANSIENT_SINGLE_SITE_ID, {
      bootstrapSite: { host: "notes.example.com" },
    }).setUpInstance(OWNER);

    expect(await db.select().from(siteDomains)).toEqual([
      expect.objectContaining({ host: "notes.example.com", kind: "primary" }),
    ]);
  });

  // A deployment runs this on every start. The owner may have changed the
  // password since, and a restart must not quietly put the old one back.
  it("changes nothing on an install that finished setup", async () => {
    const first = await bootstrap().setUpInstance({
      ...OWNER,
      siteName: "Field Notes",
    });
    const hashBefore = await storedPasswordHash(db);

    const second = await bootstrap().setUpInstance({
      email: "someone-else@example.com",
      password: "a different password",
      siteName: "Renamed",
    });

    expect(second).toEqual({
      outcome: "already-set-up",
      siteId: first.siteId,
    });
    expect(await storedPasswordHash(db)).toBe(hashBefore);
    expect(await db.select().from(user)).toHaveLength(1);
    expect((await readSettings(db, first.siteId)).SITE_NAME).toBe(
      "Field Notes",
    );
  });

  it("refuses a site id that is not the install's", async () => {
    await bootstrap().setUpInstance(OWNER);

    await expect(
      bootstrap().setUpInstance({ ...OWNER, siteId: SNAPSHOT_SITE_ID }),
    ).rejects.toThrow(`not ${SNAPSHOT_SITE_ID}`);
  });

  describe("after a run that stopped once the account existed", () => {
    beforeEach(async () => {
      await bootstrap().setUpInstance(OWNER);
      // Undo everything past the account, which is where an interrupted run
      // leaves an install.
      await db.run(sql`DELETE FROM "site"`);
    });

    it("finishes with the same address and password", async () => {
      const result = await bootstrap().setUpInstance({
        ...OWNER,
        siteId: SNAPSHOT_SITE_ID,
        siteName: "Field Notes",
      });

      expect(result).toEqual({ outcome: "resumed", siteId: SNAPSHOT_SITE_ID });
      expect(await db.select().from(user)).toHaveLength(1);
      expect((await db.select().from(user))[0]?.name).toBe("Field Notes");
      expect((await readSettings(db, SNAPSHOT_SITE_ID)).ONBOARDING_STATUS).toBe(
        "completed",
      );
    });

    it("refuses the wrong password", async () => {
      await expect(
        bootstrap().setUpInstance({ ...OWNER, password: "not the password" }),
      ).rejects.toThrow("does not match");
      expect(await db.select().from(sites)).toHaveLength(0);
    });

    it("refuses another address", async () => {
      await expect(
        bootstrap().setUpInstance({
          email: "someone-else@example.com",
          password: OWNER.password,
        }),
      ).rejects.toThrow("already has an account under another address");
      expect(await db.select().from(user)).toHaveLength(1);
      expect(await db.select().from(sites)).toHaveLength(0);
    });
  });

  // A hosted site's owner arrives through the control plane's handoff, so
  // this refuses before creating an account in a database every tenant shares.
  it("refuses a host-based install before writing anything", async () => {
    await expect(
      bootstrap({ siteResolutionMode: "host-based" }).setUpInstance(OWNER),
    ).rejects.toThrow("setUpInstance runs on self-hosted installs only");

    expect(await db.select().from(user)).toHaveLength(0);
    expect(await db.select().from(sites)).toHaveLength(0);
  });
});
