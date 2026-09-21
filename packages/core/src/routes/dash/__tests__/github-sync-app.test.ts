/**
 * GitHub App connect flow: who may see and use an installation.
 *
 * A GitHub App installs once per GitHub account, so the author of a
 * second site cannot install it again — GitHub sends them to the
 * existing installation's Configure page and never calls back. These
 * tests pin the way out of that: installations follow the author across
 * the sites they belong to, and stop at every other tenant.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { DEFAULT_TEST_SITE_ID } from "../../../__tests__/helpers/db.js";
import { settingsRoutes } from "../settings.js";

const SECOND_SITE_ID = "sit_second00000000000000000000000";
const OTHER_TENANT_SITE_ID = "sit_other000000000000000000000000";
/** The user id `createTestApp({ authenticated: true })` signs in as. */
const AUTHOR_ID = "test-user";

const setupWebhook = vi.fn();
const pushFullSync = vi.fn();
const classifyRepoForSync = vi.fn();
const getInstallation = vi.fn();

vi.mock("../../../services/github-sync.js", () => ({
  classifyRepoForSync: (...args: unknown[]) => classifyRepoForSync(...args),
  createGitHubSyncService: () => ({
    setupWebhook,
    pushFullSync,
  }),
}));

vi.mock("../../../lib/github-api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/github-api.js")>()),
  createGitHubClient: () => ({}),
}));

vi.mock("../../../lib/github-app.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/github-app.js")>()),
  getInstallation: (...args: unknown[]) => getInstallation(...args),
}));

function createGitHubApp(options: { authenticated?: boolean } = {}) {
  const harness = createTestApp({
    authenticated: options.authenticated ?? true,
  });
  harness.app.use("*", async (c, next) => {
    c.env.GITHUB_APP_ID = "12345";
    c.env.GITHUB_APP_PRIVATE_KEY =
      "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----";
    c.env.GITHUB_APP_SLUG = "jant-sync";
    await next();
  });
  harness.app.route("/settings", settingsRoutes);
  return harness;
}

function insertSite(
  sqlite: ReturnType<typeof createTestApp>["sqlite"],
  siteId: string,
  key: string,
) {
  const timestamp = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      `INSERT INTO site (id, key, status, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?)`,
    )
    .run(siteId, key, timestamp, timestamp);
}

function insertMember(
  sqlite: ReturnType<typeof createTestApp>["sqlite"],
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

function insertInstallation(
  sqlite: ReturnType<typeof createTestApp>["sqlite"],
  installationId: string,
  siteId: string,
  login: string,
) {
  sqlite
    .prepare(
      `INSERT INTO github_app_installation
         (installation_id, site_id, account_login, account_type, account_avatar_url, added_at)
       VALUES (?, ?, ?, 'User', '', ?)`,
    )
    .run(installationId, siteId, login, Math.floor(Date.now() / 1000));
}

/** An installation on a site belonging to somebody else entirely. */
function insertOtherTenantInstallation(
  sqlite: ReturnType<typeof createTestApp>["sqlite"],
) {
  insertSite(sqlite, OTHER_TENANT_SITE_ID, "other-tenant");
  insertMember(sqlite, OTHER_TENANT_SITE_ID, "somebody-else");
  insertInstallation(sqlite, "inst-theirs", OTHER_TENANT_SITE_ID, "stranger");
}

/**
 * The author's *other* site already connected through the App, and the
 * site under test has no binding of its own — the second-blog case.
 */
function insertSiblingSiteInstallation(
  sqlite: ReturnType<typeof createTestApp>["sqlite"],
) {
  insertSite(sqlite, SECOND_SITE_ID, "second");
  insertMember(sqlite, SECOND_SITE_ID, AUTHOR_ID);
  insertInstallation(sqlite, "inst-mine", SECOND_SITE_ID, "octo");
}

describe("GitHub App connect flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /settings/github-sync/app/install", () => {
    it("sends a first-time author to GitHub to install the App", async () => {
      const { app } = createGitHubApp();

      const res = await app.request("/settings/github-sync/app/install");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain(
        "https://github.com/apps/jant-sync/installations/new",
      );
    });

    it("renders the picker when the author authorized an account on another of their sites", async () => {
      const { app, sqlite } = createGitHubApp();
      insertSiblingSiteInstallation(sqlite);

      const res = await app.request("/settings/github-sync/app/install");

      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<jant-repo-picker");
    });

    it("still reaches GitHub when the author asks to add another account", async () => {
      const { app, sqlite } = createGitHubApp();
      insertSiblingSiteInstallation(sqlite);

      const res = await app.request(
        "/settings/github-sync/app/install?force=new",
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("github.com");
    });

    it("ignores an installation bound to another tenant's site", async () => {
      const { app, sqlite } = createGitHubApp();
      insertOtherTenantInstallation(sqlite);

      const res = await app.request("/settings/github-sync/app/install");

      expect(res.status).toBe(302);
    });
  });

  describe("GET /settings/github-sync/app/installations", () => {
    it("lists the account the author authorized on another of their sites", async () => {
      const { app, sqlite } = createGitHubApp();
      insertSiblingSiteInstallation(sqlite);
      insertOtherTenantInstallation(sqlite);

      const res = await app.request("/settings/github-sync/app/installations");

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        installations: Array<{
          installationId: string;
          account: { login: string };
        }>;
      };
      expect(body.installations).toHaveLength(1);
      expect(body.installations[0]).toMatchObject({
        installationId: "inst-mine",
        account: { login: "octo" },
      });
    });
  });

  describe("another tenant's installation id", () => {
    it("is not a repository list", async () => {
      const { app, sqlite } = createGitHubApp();
      insertOtherTenantInstallation(sqlite);

      const res = await app.request(
        "/settings/github-sync/app/repos?installationId=inst-theirs",
      );

      expect(res.status).toBe(404);
    });

    it("is not classifiable", async () => {
      const { app, sqlite } = createGitHubApp();
      insertOtherTenantInstallation(sqlite);

      const res = await app.request("/settings/github-sync/app/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          installationId: "inst-theirs",
          repo: "stranger/private-notes",
        }),
      });

      expect(res.status).toBe(404);
      expect(classifyRepoForSync).not.toHaveBeenCalled();
    });

    it("is not connectable", async () => {
      const { app, sqlite } = createGitHubApp();
      insertOtherTenantInstallation(sqlite);

      const res = await app.request("/settings/github-sync/app/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          installationId: "inst-theirs",
          repo: "stranger/private-notes",
          confirmForeign: true,
        }),
      });

      expect(res.status).toBe(404);
      expect(setupWebhook).not.toHaveBeenCalled();
    });
  });

  describe("POST /settings/github-sync/app/connect", () => {
    it("records the installation against this site", async () => {
      const { app, sqlite, services } = createGitHubApp();
      insertSiblingSiteInstallation(sqlite);
      classifyRepoForSync.mockResolvedValue({ kind: "empty" });

      const res = await app.request("/settings/github-sync/app/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          installationId: "inst-mine",
          repo: "octo/second-blog",
        }),
      });

      expect(res.status).toBe(200);
      expect(setupWebhook).toHaveBeenCalledOnce();

      // Without this row the App webhook's fan-out — uninstall, suspend,
      // repository removed — never reaches the site it just connected.
      const bound =
        await services.githubAppInstallations.listInstallationsForSite(
          DEFAULT_TEST_SITE_ID,
        );
      expect(bound).toHaveLength(1);
      expect(bound[0]).toMatchObject({
        installationId: "inst-mine",
        account: { login: "octo" },
      });
      expect(await services.settings.get("GITHUB_SYNC_REPO")).toBe(
        "octo/second-blog",
      );
      expect(await services.settings.get("GITHUB_SYNC_ENABLED")).toBe("true");
    });
  });
  describe("a site syncing through the App with no binding to show for it", () => {
    /** What the old connect path left behind: settings, no junction row. */
    function insertUnboundSyncingSite(
      sqlite: ReturnType<typeof createTestApp>["sqlite"],
    ) {
      insertSite(sqlite, SECOND_SITE_ID, "second");
      insertMember(sqlite, SECOND_SITE_ID, AUTHOR_ID);
      const timestamp = Math.floor(Date.now() / 1000);
      for (const [key, value] of [
        ["GITHUB_SYNC_AUTH_MODE", "app"],
        ["GITHUB_SYNC_APP_INSTALLATION_ID", "inst-orphan"],
      ]) {
        sqlite
          .prepare(
            `INSERT INTO site_setting (site_id, key, value, updated_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(SECOND_SITE_ID, key, value, timestamp);
      }
    }

    it("rebuilds the binding from GitHub instead of sending the author to a dead end", async () => {
      const { app, sqlite, services } = createGitHubApp();
      insertUnboundSyncingSite(sqlite);
      getInstallation.mockResolvedValue({
        account: { login: "octo", type: "User", avatarUrl: "" },
      });

      const res = await app.request("/settings/github-sync/app/install");

      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<jant-repo-picker");
      expect(getInstallation).toHaveBeenCalledOnce();
      expect(
        await services.githubAppInstallations.listInstallationsForSite(
          SECOND_SITE_ID,
        ),
      ).toMatchObject([{ installationId: "inst-orphan" }]);
    });

    it("falls back to the GitHub redirect when the installation is gone", async () => {
      const { app, sqlite } = createGitHubApp();
      insertUnboundSyncingSite(sqlite);
      getInstallation.mockRejectedValue(
        new Error("Fetching installation failed (404)"),
      );

      const res = await app.request("/settings/github-sync/app/install");

      expect(res.status).toBe(302);
    });

    it("does not touch GitHub when the author already has a binding", async () => {
      const { app, sqlite } = createGitHubApp();
      insertSiblingSiteInstallation(sqlite);

      const res = await app.request("/settings/github-sync/app/install");

      expect(res.status).toBe(200);
      expect(getInstallation).not.toHaveBeenCalled();
    });
  });
});
