import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
  DEFAULT_TEST_SITE_KEY,
} from "../../__tests__/helpers/db.js";
import type { Database } from "../../db/index.js";
import {
  createGitHubAppInstallationsService,
  type GitHubAppInstallationsService,
  type GitHubInstallationAccount,
} from "../github-app-installations.js";

const SECOND_SITE_ID = "sit_second00000000000000000000000";
const SECOND_SITE_KEY = "second";

function insertSecondSite(sqlite: ReturnType<typeof createTestDatabase>["sqlite"]) {
  const timestamp = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      `INSERT INTO site (id, key, status, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?)`,
    )
    .run(SECOND_SITE_ID, SECOND_SITE_KEY, timestamp, timestamp);
}

function makeAccount(
  overrides: Partial<GitHubInstallationAccount> = {},
): GitHubInstallationAccount {
  return {
    login: "acme",
    type: "Organization",
    avatarUrl: "https://example.com/a.png",
    ...overrides,
  };
}

describe("GitHubAppInstallationsService", () => {
  let db: Database;
  let sqlite: ReturnType<typeof createTestDatabase>["sqlite"];
  let service: GitHubAppInstallationsService;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    sqlite = testDb.sqlite;
    service = createGitHubAppInstallationsService(db);
  });

  it("returns empty list for an unknown site", async () => {
    expect(await service.listInstallationsForSite(DEFAULT_TEST_SITE_ID)).toEqual(
      [],
    );
  });

  it("returns empty list of sites for an unknown installation", async () => {
    expect(await service.listSitesForInstallation("inst-missing")).toEqual([]);
  });

  it("upserts a new installation and lists it", async () => {
    await service.upsertInstallation(
      "inst-1",
      DEFAULT_TEST_SITE_ID,
      makeAccount({ login: "octo", type: "User" }),
    );
    const list = await service.listInstallationsForSite(DEFAULT_TEST_SITE_ID);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      installationId: "inst-1",
      siteId: DEFAULT_TEST_SITE_ID,
      account: { login: "octo", type: "User" },
    });
  });

  it("refreshes account snapshot on re-upsert but preserves addedAt", async () => {
    await service.upsertInstallation(
      "inst-1",
      DEFAULT_TEST_SITE_ID,
      makeAccount({ login: "old-name" }),
    );
    const initial = await service.listInstallationsForSite(
      DEFAULT_TEST_SITE_ID,
    );
    const addedAt = initial[0]!.addedAt;

    await service.upsertInstallation(
      "inst-1",
      DEFAULT_TEST_SITE_ID,
      makeAccount({ login: "renamed-org", avatarUrl: "https://x.png" }),
    );
    const updated = await service.listInstallationsForSite(
      DEFAULT_TEST_SITE_ID,
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]!.addedAt).toBe(addedAt);
    expect(updated[0]!.account.login).toBe("renamed-org");
    expect(updated[0]!.account.avatarUrl).toBe("https://x.png");
  });

  it("binds one installation to multiple sites", async () => {
    insertSecondSite(sqlite);

    await service.upsertInstallation(
      "inst-1",
      DEFAULT_TEST_SITE_ID,
      makeAccount(),
    );
    await service.upsertInstallation("inst-1", SECOND_SITE_ID, makeAccount());

    const sites = await service.listSitesForInstallation("inst-1");
    expect(sites).toHaveLength(2);
    expect(new Set(sites)).toEqual(
      new Set([DEFAULT_TEST_SITE_ID, SECOND_SITE_ID]),
    );
  });

  it("removes a single (installation, site) binding without affecting peers", async () => {
    insertSecondSite(sqlite);

    await service.upsertInstallation(
      "inst-1",
      DEFAULT_TEST_SITE_ID,
      makeAccount(),
    );
    await service.upsertInstallation("inst-1", SECOND_SITE_ID, makeAccount());

    await service.removeInstallation("inst-1", DEFAULT_TEST_SITE_ID);

    expect(
      await service.listInstallationsForSite(DEFAULT_TEST_SITE_ID),
    ).toEqual([]);
    expect(await service.listSitesForInstallation("inst-1")).toEqual([
      SECOND_SITE_ID,
    ]);
  });

  it("removeInstallationEverywhere returns the affected site ids", async () => {
    insertSecondSite(sqlite);

    await service.upsertInstallation(
      "inst-1",
      DEFAULT_TEST_SITE_ID,
      makeAccount(),
    );
    await service.upsertInstallation("inst-1", SECOND_SITE_ID, makeAccount());

    const affected = await service.removeInstallationEverywhere("inst-1");
    expect(new Set(affected)).toEqual(
      new Set([DEFAULT_TEST_SITE_ID, SECOND_SITE_ID]),
    );
    expect(await service.listSitesForInstallation("inst-1")).toEqual([]);
  });

  it("removeInstallationEverywhere is a no-op when nothing is bound", async () => {
    expect(await service.removeInstallationEverywhere("inst-missing")).toEqual(
      [],
    );
  });

  it("orders listInstallationsForSite newest-first", async () => {
    await service.upsertInstallation(
      "inst-older",
      DEFAULT_TEST_SITE_ID,
      makeAccount({ login: "a" }),
    );
    // Force a distinct addedAt for the second row so ordering is deterministic
    // without relying on sub-second timestamp resolution.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await service.upsertInstallation(
      "inst-newer",
      DEFAULT_TEST_SITE_ID,
      makeAccount({ login: "b" }),
    );

    const list = await service.listInstallationsForSite(DEFAULT_TEST_SITE_ID);
    expect(list.map((entry) => entry.installationId)).toEqual([
      "inst-newer",
      "inst-older",
    ]);
  });
});
