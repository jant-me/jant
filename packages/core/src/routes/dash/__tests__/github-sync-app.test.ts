/**
 * GitHub App connect flow: who may see and use an installation.
 *
 * A GitHub App installs once per GitHub account, so the author of a
 * second site cannot install it again — GitHub sends them to the
 * existing installation's Configure page and never calls back. These
 * tests pin the way out of that: installations follow the author across
 * the sites they belong to, and stop at every other tenant.
 *
 * With the App's client credentials set, a new binding needs GitHub's
 * word that the author owns the installation. The id in the callback URL
 * is anyone's to type, so the callback tests pin that it is never what
 * gets bound. Without them, only a single-site deployment, whose one
 * account holds the App's private key anyway, binds that id.
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
const listOwnedInstallations = vi.fn();

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
  listOwnedInstallations: (...args: unknown[]) =>
    listOwnedInstallations(...args),
}));

function createGitHubApp(
  options: {
    authenticated?: boolean;
    oauth?: boolean;
    mode?: "single-site" | "host-based";
  } = {},
) {
  const harness = createTestApp({
    authenticated: options.authenticated ?? true,
  });
  harness.app.use("*", async (c, next) => {
    c.env.GITHUB_APP_ID = "12345";
    c.env.GITHUB_APP_PRIVATE_KEY =
      "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----";
    c.env.GITHUB_APP_SLUG = "jant-sync";
    if (options.oauth ?? true) {
      c.env.GITHUB_APP_CLIENT_ID = "Iv1.client";
      c.env.GITHUB_APP_CLIENT_SECRET = "client-secret";
    }
    if (options.mode) c.env.SITE_RESOLUTION_MODE = options.mode;
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
    it("asks GitHub what a first-time author owns before installing", async () => {
      // The App may already be on their GitHub account, put there through
      // another Jant account, and GitHub's install page is a dead end for
      // an account that has it.
      const { app } = createGitHubApp();

      const res = await app.request("/settings/github-sync/app/install");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(
        /^https:\/\/github\.com\/login\/oauth\/authorize\?client_id=Iv1\.client&/,
      );
    });

    it("installs straight away on a single-site deployment without client credentials", async () => {
      const { app } = createGitHubApp({ oauth: false });

      const res = await app.request("/settings/github-sync/app/install");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain(
        "https://github.com/apps/jant-sync/installations/new",
      );
    });

    it("names the missing variables on a host-based deployment without client credentials", async () => {
      const { app } = createGitHubApp({ oauth: false, mode: "host-based" });

      const res = await app.request("/settings/github-sync/app/install");

      expect(res.status).toBe(500);
      expect(await res.text()).toContain("GITHUB_APP_CLIENT_SECRET");
    });

    it("still opens the picker without client credentials when the author has an account", async () => {
      const { app, sqlite } = createGitHubApp({ oauth: false });
      insertSiblingSiteInstallation(sqlite);

      const res = await app.request("/settings/github-sync/app/install");

      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<jant-repo-picker");
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
      expect(res.headers.get("location")).toContain(
        "https://github.com/apps/jant-sync/installations/new",
      );
    });

    it("ignores an installation bound to another tenant's site", async () => {
      const { app, sqlite } = createGitHubApp();
      insertOtherTenantInstallation(sqlite);

      const res = await app.request("/settings/github-sync/app/install");

      expect(res.status).toBe(302);
    });
  });

  describe("GET /settings/github-sync/app/callback", () => {
    /** Start a trip to GitHub the way the settings page does, keeping its cookies. */
    async function startTrip(
      app: ReturnType<typeof createGitHubApp>["app"],
      path = "/settings/github-sync/app/install",
    ) {
      const res = await app.request(path);
      const location = new URL(res.headers.get("location") ?? "");
      const cookie = res.headers
        .getSetCookie()
        .map((header) => header.split(";")[0])
        .join("; ");
      return { state: location.searchParams.get("state") ?? "", cookie };
    }

    it("never binds the installation id GitHub's install page passes along", async () => {
      // The attack: start an install trip of your own, so the state and
      // cookie are genuine, then come back with someone else's id.
      const { app, sqlite, services } = createGitHubApp();
      insertOtherTenantInstallation(sqlite);
      getInstallation.mockResolvedValue({
        account: { login: "stranger", type: "User", avatarUrl: "" },
      });
      const { state, cookie } = await startTrip(
        app,
        "/settings/github-sync/app/install?force=new",
      );

      const res = await app.request(
        `/settings/github-sync/app/callback?installation_id=inst-theirs&setup_action=install&state=${encodeURIComponent(state)}`,
        { headers: { cookie } },
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain(
        "https://github.com/login/oauth/authorize",
      );
      expect(getInstallation).not.toHaveBeenCalled();
      expect(
        await services.githubAppInstallations.listInstallationsForSite(
          DEFAULT_TEST_SITE_ID,
        ),
      ).toEqual([]);
    });

    it("binds the installations GitHub says the author owns, and nothing else", async () => {
      const { app, sqlite, services } = createGitHubApp();
      insertOtherTenantInstallation(sqlite);
      listOwnedInstallations.mockResolvedValue([
        {
          installationId: "inst-owned",
          account: { login: "octo", type: "User", avatarUrl: "" },
        },
      ]);
      const { state, cookie } = await startTrip(app);

      const res = await app.request(
        `/settings/github-sync/app/callback?code=gh-code&state=${encodeURIComponent(state)}&installation_id=inst-theirs`,
        { headers: { cookie } },
      );

      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<jant-repo-picker");
      expect(listOwnedInstallations).toHaveBeenCalledWith(
        { clientId: "Iv1.client", clientSecret: "client-secret" },
        "gh-code",
        expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      );
      expect(
        await services.githubAppInstallations.listInstallationsForSite(
          DEFAULT_TEST_SITE_ID,
        ),
      ).toMatchObject([{ installationId: "inst-owned" }]);
    });

    it("sends an author who owns no installation on to the install page", async () => {
      const { app, services } = createGitHubApp();
      listOwnedInstallations.mockResolvedValue([]);
      const { state, cookie } = await startTrip(app);

      const res = await app.request(
        `/settings/github-sync/app/callback?code=gh-code&state=${encodeURIComponent(state)}`,
        { headers: { cookie } },
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain(
        "https://github.com/apps/jant-sync/installations/new",
      );
      expect(
        await services.githubAppInstallations.listInstallationsForSite(
          DEFAULT_TEST_SITE_ID,
        ),
      ).toEqual([]);
    });

    it("turns away a code that arrives without this browser's state", async () => {
      // Otherwise a forged link could bind the attacker's GitHub account to
      // this author's site, and their posts would be pushed there.
      const { app } = createGitHubApp();
      const { cookie } = await startTrip(app);

      const res = await app.request(
        "/settings/github-sync/app/callback?code=attacker-code&state=forged",
        { headers: { cookie } },
      );

      expect(res.status).toBe(400);
      expect(listOwnedInstallations).not.toHaveBeenCalled();
    });

    it("stops when the author declines sign-in instead of asking again", async () => {
      const { app } = createGitHubApp();
      const { state, cookie } = await startTrip(app);

      const res = await app.request(
        `/settings/github-sync/app/callback?error=access_denied&state=${encodeURIComponent(state)}`,
        { headers: { cookie } },
      );

      expect(res.status).toBe(400);
      expect(await res.text()).toContain("declined");
    });

    it("says what to do when GitHub does not confirm the accounts", async () => {
      const { app } = createGitHubApp();
      listOwnedInstallations.mockRejectedValue(
        new Error(
          "GitHub OAuth code exchange failed (200): bad_verification_code",
        ),
      );
      const { state, cookie } = await startTrip(app);

      const res = await app.request(
        `/settings/github-sync/app/callback?code=stale&state=${encodeURIComponent(state)}`,
        { headers: { cookie } },
      );

      expect(res.status).toBe(502);
      expect(await res.text()).toContain("Start again");
    });

    describe("without client credentials", () => {
      it("binds the installation the install page names on a single-site deployment", async () => {
        // Its one account runs the deployment and holds the App's private
        // key, so a forged id gets it nothing it couldn't reach already.
        const { app, services } = createGitHubApp({ oauth: false });
        getInstallation.mockResolvedValue({
          account: { login: "octo", type: "User", avatarUrl: "" },
        });
        const { state, cookie } = await startTrip(app);

        const res = await app.request(
          `/settings/github-sync/app/callback?installation_id=inst-new&setup_action=install&state=${encodeURIComponent(state)}`,
          { headers: { cookie } },
        );

        expect(res.status).toBe(200);
        expect(await res.text()).toContain("<jant-repo-picker");
        expect(getInstallation).toHaveBeenCalledWith(
          expect.anything(),
          "inst-new",
        );
        expect(
          await services.githubAppInstallations.listInstallationsForSite(
            DEFAULT_TEST_SITE_ID,
          ),
        ).toMatchObject([{ installationId: "inst-new" }]);
      });

      it("turns away an install callback without this browser's state", async () => {
        const { app } = createGitHubApp({ oauth: false });
        const { cookie } = await startTrip(app);

        const res = await app.request(
          "/settings/github-sync/app/callback?installation_id=inst-new&state=forged",
          { headers: { cookie } },
        );

        expect(res.status).toBe(400);
        expect(getInstallation).not.toHaveBeenCalled();
      });

      it("keeps the trip open when GitHub doesn't answer, so a reload retries", async () => {
        // GitHub won't call back a second time for an App now installed.
        const { app } = createGitHubApp({ oauth: false });
        getInstallation.mockRejectedValue(
          new Error("Fetching installation failed (500)"),
        );
        const { state, cookie } = await startTrip(app);

        const res = await app.request(
          `/settings/github-sync/app/callback?installation_id=inst-new&state=${encodeURIComponent(state)}`,
          { headers: { cookie } },
        );

        expect(res.status).toBe(502);
        expect(res.headers.getSetCookie()).toEqual([]);
      });

      it("binds nothing on a host-based deployment", async () => {
        const { app, sqlite, services } = createGitHubApp({
          oauth: false,
          mode: "host-based",
        });
        insertOtherTenantInstallation(sqlite);

        const res = await app.request(
          "/settings/github-sync/app/callback?installation_id=inst-theirs&state=any",
        );

        expect(res.status).toBe(500);
        expect(getInstallation).not.toHaveBeenCalled();
        expect(
          await services.githubAppInstallations.listInstallationsForSite(
            DEFAULT_TEST_SITE_ID,
          ),
        ).toEqual([]);
      });
    });
  });

  describe("the labels the picker is handed", () => {
    async function renderPicker() {
      const { app, sqlite } = createGitHubApp();
      insertSiblingSiteInstallation(sqlite);
      const res = await app.request("/settings/github-sync/app/install");
      expect(res.status).toBe(200);
      return await res.text();
    }

    it("fills in the suggested repository name", async () => {
      // `i18n._()` renders a placeholder it has no value for as an empty
      // string, which left the hint reading "Name prefilled as ."
      expect(await renderPicker()).toMatch(
        /Name prefilled as [a-z0-9-]+-jant-sync\./,
      );
    });

    it("keeps the placeholders the component fills in itself", async () => {
      const html = await renderPicker();

      expect(html).toContain("Showing {shown} of {total}");
      expect(html).toContain("Type {repo} to confirm");
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
