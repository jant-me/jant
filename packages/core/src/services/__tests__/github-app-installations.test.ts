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

function insertSecondSite(
  sqlite: ReturnType<typeof createTestDatabase>["sqlite"],
) {
  const timestamp = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      `INSERT INTO site (id, key, status, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?)`,
    )
    .run(SECOND_SITE_ID, SECOND_SITE_KEY, timestamp, timestamp);
}

const OWNER_USER_ID = "usr_owner0000000000000000000000000";
const OTHER_USER_ID = "usr_other0000000000000000000000000";

function addMember(
  sqlite: ReturnType<typeof createTestDatabase>["sqlite"],
  siteId: string,
  userId: string,
) {
  const timestamp = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      `INSERT INTO site_member (site_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, 'owner', ?, ?)`,
    )
    .run(siteId, userId, timestamp, timestamp);
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
    expect(
      await service.listInstallationsForSite(DEFAULT_TEST_SITE_ID),
    ).toEqual([]);
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
    const initial =
      await service.listInstallationsForSite(DEFAULT_TEST_SITE_ID);
    const addedAt = initial[0]!.addedAt;

    await service.upsertInstallation(
      "inst-1",
      DEFAULT_TEST_SITE_ID,
      makeAccount({ login: "renamed-org", avatarUrl: "https://x.png" }),
    );
    const updated =
      await service.listInstallationsForSite(DEFAULT_TEST_SITE_ID);
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
  describe("user-scoped visibility", () => {
    it("returns nothing for a user with no sites", async () => {
      await service.upsertInstallation(
        "inst-1",
        DEFAULT_TEST_SITE_ID,
        makeAccount(),
      );
      expect(await service.listInstallationsForUser(OWNER_USER_ID)).toEqual([]);
    });

    it("surfaces an installation bound to another site the user belongs to", async () => {
      insertSecondSite(sqlite);
      addMember(sqlite, DEFAULT_TEST_SITE_ID, OWNER_USER_ID);
      addMember(sqlite, SECOND_SITE_ID, OWNER_USER_ID);

      // Bound to the first site only — the second site is the one trying
      // to connect, and GitHub will not install the App twice on one
      // account, so this row is its only way in.
      await service.upsertInstallation(
        "inst-1",
        DEFAULT_TEST_SITE_ID,
        makeAccount({ login: "octo", type: "User" }),
      );

      const visible = await service.listInstallationsForUser(OWNER_USER_ID);
      expect(visible).toHaveLength(1);
      expect(visible[0]).toMatchObject({
        installationId: "inst-1",
        account: { login: "octo", type: "User" },
      });
      expect(await service.listInstallationsForSite(SECOND_SITE_ID)).toEqual(
        [],
      );
    });

    it("hides installations bound to sites the user is not a member of", async () => {
      insertSecondSite(sqlite);
      addMember(sqlite, DEFAULT_TEST_SITE_ID, OWNER_USER_ID);
      addMember(sqlite, SECOND_SITE_ID, OTHER_USER_ID);

      await service.upsertInstallation(
        "inst-theirs",
        SECOND_SITE_ID,
        makeAccount({ login: "somebody-else" }),
      );

      expect(await service.listInstallationsForUser(OWNER_USER_ID)).toEqual([]);
      expect(
        await service.findInstallationForUser("inst-theirs", OWNER_USER_ID),
      ).toBeNull();
      expect(
        await service.findInstallationForUser("inst-theirs", OTHER_USER_ID),
      ).toMatchObject({ installationId: "inst-theirs" });
    });

    it("lists an installation once when several of the user's sites share it", async () => {
      insertSecondSite(sqlite);
      addMember(sqlite, DEFAULT_TEST_SITE_ID, OWNER_USER_ID);
      addMember(sqlite, SECOND_SITE_ID, OWNER_USER_ID);

      await service.upsertInstallation(
        "inst-1",
        DEFAULT_TEST_SITE_ID,
        makeAccount(),
      );
      await service.upsertInstallation("inst-1", SECOND_SITE_ID, makeAccount());

      const visible = await service.listInstallationsForUser(OWNER_USER_ID);
      expect(visible.map((entry) => entry.installationId)).toEqual(["inst-1"]);
    });

    it("removeInstallationForUser clears every binding the user can see", async () => {
      insertSecondSite(sqlite);
      addMember(sqlite, DEFAULT_TEST_SITE_ID, OWNER_USER_ID);

      await service.upsertInstallation(
        "inst-1",
        DEFAULT_TEST_SITE_ID,
        makeAccount(),
      );
      // A site the user has nothing to do with keeps its binding: only
      // the App webhook's `installation.deleted` speaks for everyone.
      await service.upsertInstallation("inst-1", SECOND_SITE_ID, makeAccount());

      await service.removeInstallationForUser("inst-1", OWNER_USER_ID);

      expect(await service.listInstallationsForUser(OWNER_USER_ID)).toEqual([]);
      expect(await service.listSitesForInstallation("inst-1")).toEqual([
        SECOND_SITE_ID,
      ]);
    });
    it("reads syncing installations from settings only for the user's own sites", async () => {
      insertSecondSite(sqlite);
      addMember(sqlite, DEFAULT_TEST_SITE_ID, OWNER_USER_ID);
      addMember(sqlite, SECOND_SITE_ID, OTHER_USER_ID);
      const timestamp = Math.floor(Date.now() / 1000);
      const setSetting = (siteId: string, key: string, value: string) =>
        sqlite
          .prepare(
            `INSERT INTO site_setting (site_id, key, value, updated_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(siteId, key, value, timestamp);

      setSetting(
        DEFAULT_TEST_SITE_ID,
        "GITHUB_SYNC_APP_INSTALLATION_ID",
        "inst-mine",
      );
      setSetting(
        SECOND_SITE_ID,
        "GITHUB_SYNC_APP_INSTALLATION_ID",
        "inst-theirs",
      );

      expect(
        await service.listSyncingInstallationsForUser(OWNER_USER_ID),
      ).toEqual([
        { siteId: DEFAULT_TEST_SITE_ID, installationId: "inst-mine" },
      ]);
    });

    it("skips a site whose stored installation id was cleared", async () => {
      addMember(sqlite, DEFAULT_TEST_SITE_ID, OWNER_USER_ID);
      sqlite
        .prepare(
          `INSERT INTO site_setting (site_id, key, value, updated_at)
           VALUES (?, 'GITHUB_SYNC_APP_INSTALLATION_ID', '', ?)`,
        )
        .run(DEFAULT_TEST_SITE_ID, Math.floor(Date.now() / 1000));

      expect(
        await service.listSyncingInstallationsForUser(OWNER_USER_ID),
      ).toEqual([]);
    });
  });
});
