/**
 * Tests for which of the two self-hosted setup screens a request gets.
 *
 * The step is never in the URL. It is read from the onboarding status and, on
 * the second screen, from whether the site has a name yet — the only records
 * that survive a closed tab, a reload, or a back button. These cover the route
 * making that choice; `setup-page.test.tsx` covers what each screen then says.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createI18n } from "../../../i18n/index.js";
import { attachSession } from "../../../middleware/session.js";
import { ONBOARDING_STATUS } from "../../../lib/constants.js";
import { setupRoutes } from "../setup.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const SESSION_COOKIE = "jant.session_token=abc; Path=/; HttpOnly";

function createMockAuth(signedIn: boolean) {
  const signUpEmail = vi.fn(async () => ({
    headers: new Headers({ "Set-Cookie": SESSION_COOKIE }),
    response: { user: { id: "usr_new-owner" } },
  }));
  const updateUser = vi.fn(async () => ({}));

  return {
    signUpEmail,
    updateUser,
    auth: {
      api: {
        signUpEmail,
        updateUser,
        getSession: async () => ({
          headers: new Headers(),
          response: signedIn
            ? {
                user: { id: "usr_owner", email: "owner@test.com", name: "O" },
                session: { id: "ses_owner" },
              }
            : null,
        }),
      },
    } as unknown as AppVariables["auth"],
  };
}

function createSetupApp(options: {
  status: (typeof ONBOARDING_STATUS)[keyof typeof ONBOARDING_STATUS];
  /** What `SITE_NAME` holds — null on a site nobody has named yet. */
  storedSiteName?: string | null;
  signedIn?: boolean;
  isMember?: boolean;
}) {
  const provisionOwnerAccount = vi.fn(async () => {});
  const completeSiteSetup = vi.fn(async () => {});
  const updateDiscoverSetting = vi.fn(async () => ({ shouldAnnounce: false }));
  const { auth, signUpEmail, updateUser } = createMockAuth(
    options.signedIn ?? false,
  );

  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.env = {} as Bindings;
    c.set("auth", auth);
    c.set("services", {
      settings: {
        getOnboardingStatus: async () => options.status,
        get: async (key: string) =>
          key === "SITE_NAME" ? (options.storedSiteName ?? null) : null,
        updateDiscoverSetting,
      },
      bootstrap: { provisionOwnerAccount, completeSiteSetup },
      siteMembers: {
        get: async () =>
          options.isMember
            ? {
                createdAt: 0,
                role: "owner",
                siteId: "sit_test",
                updatedAt: 0,
                userId: "usr_owner",
              }
            : null,
      },
    } as unknown as AppVariables["services"]);
    c.set("currentSite", {
      createdAt: 0,
      id: "sit_test",
      key: "default",
      status: "active",
      updatedAt: 0,
    });
    c.set("appConfig", {
      siteName: "Jant",
      sitePathPrefix: "",
      siteLanguage: "en",
      demoMode: false,
      noindex: false,
      rssFeedsEnabled: true,
    } as AppVariables["appConfig"]);
    c.set("lang", "en");
    c.set("i18n", createI18n("en"));
    await next();
  });
  app.use("*", attachSession());
  app.route("/", setupRoutes);

  return {
    app,
    provisionOwnerAccount,
    completeSiteSetup,
    signUpEmail,
    updateUser,
  };
}

function post(app: Hono<Env>, body: Record<string, unknown>) {
  return app.request("/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /setup picks the step", () => {
  it("asks an empty site for credentials, with no session needed", async () => {
    const { app } = createSetupApp({ status: ONBOARDING_STATUS.PENDING });

    const html = await (await app.request("/setup")).text();

    expect(html).toContain("Setup · Step 1 of 2");
    expect(html).toContain("setup-password");
    expect(html).not.toContain("setup-site-name");
  });

  // The state the site rests in between the screens: an owner, and no answers.
  it("asks a provisioned but unnamed site for its name", async () => {
    const { app } = createSetupApp({
      status: ONBOARDING_STATUS.PROVISIONED,
      storedSiteName: null,
      signedIn: true,
      isMember: true,
    });

    const html = await (await app.request("/setup")).text();

    expect(html).toContain("Setup · Step 2 of 2");
    expect(html).toContain("setup-site-name");
    expect(html).not.toContain("setup-password");
  });

  // The hosted arrival at the same screen. A name it already has is a question
  // it must not be asked again.
  it("asks a named site only what it is missing", async () => {
    const { app } = createSetupApp({
      status: ONBOARDING_STATUS.PROVISIONED,
      storedSiteName: "My Blog",
      signedIn: true,
      isMember: true,
    });

    const html = await (await app.request("/setup")).text();

    expect(html).not.toContain("setup-site-name");
    expect(html).not.toContain("Step");
    expect(html).toContain("setup-content-language");
  });

  it("sends a finished site home", async () => {
    const { app } = createSetupApp({ status: ONBOARDING_STATUS.COMPLETED });

    const res = await app.request("/setup", { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });
});

describe("POST /setup, the account step", () => {
  it("opens the account, stands the site up, and comes back for step two", async () => {
    const { app, provisionOwnerAccount, signUpEmail } = createSetupApp({
      status: ONBOARDING_STATUS.PENDING,
    });

    const res = await post(app, {
      email: "  Owner@Example.COM ",
      password: "correct-horse-battery",
    });

    // Named after the address until the next screen has a site name to put
    // there, and normalized before it is used for either.
    expect(signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          name: "owner",
          email: "owner@example.com",
          password: "correct-horse-battery",
        },
      }),
    );
    expect(provisionOwnerAccount).toHaveBeenCalledWith({
      ownerUserId: "usr_new-owner",
    });
    await expect(res.text()).resolves.toContain("/setup");
  });

  // The whole reason there is no `/signin` hop between the screens: the second
  // one can only be answered by a member, so the first has to leave a session
  // behind.
  it("signs the new owner in on the way out", async () => {
    const { app } = createSetupApp({ status: ONBOARDING_STATUS.PENDING });

    const res = await post(app, {
      email: "owner@example.com",
      password: "correct-horse-battery",
    });

    expect(res.headers.get("Set-Cookie")).toBe(SESSION_COOKIE);
  });

  it("rejects a password too short to be one", async () => {
    const { app, provisionOwnerAccount } = createSetupApp({
      status: ONBOARDING_STATUS.PENDING,
    });

    const res = await post(app, { email: "owner@example.com", password: "sh" });

    await expect(res.text()).resolves.toContain("8 characters");
    expect(provisionOwnerAccount).not.toHaveBeenCalled();
  });
});

describe("POST /setup, the site step", () => {
  const owner = {
    status: ONBOARDING_STATUS.PROVISIONED,
    storedSiteName: null,
    signedIn: true,
    isMember: true,
  } as const;

  it("carries the name, the language, and the browser's clock", async () => {
    const { app, completeSiteSetup } = createSetupApp(owner);

    await post(app, {
      siteName: "My Blog",
      contentLanguage: "zh-Hans",
      language: "en-GB",
      timezone: "Asia/Shanghai",
      discover: true,
    });

    expect(completeSiteSetup).toHaveBeenCalledWith(
      {
        siteName: "My Blog",
        siteLanguage: "zh-Hans",
        browserLanguage: "en-GB",
        timeZone: "Asia/Shanghai",
      },
      { oldLanguage: "en" },
      expect.anything(),
    );
  });

  // The rename better-auth needs, wired through the service rather than run in
  // the route, and reaching better-auth with the request's own headers.
  it("hands the service a way to rename the operator's account", async () => {
    const { app, completeSiteSetup, updateUser } = createSetupApp(owner);

    await post(app, { siteName: "My Blog", contentLanguage: "en" });

    const deps = completeSiteSetup.mock.calls[0]?.[2] as {
      updateCurrentUserName: (name: string) => Promise<void>;
    };
    await deps.updateCurrentUserName("My Blog");

    expect(updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ body: { name: "My Blog" } }),
    );
  });

  it("refuses to finish an unnamed site with no name", async () => {
    const { app, completeSiteSetup } = createSetupApp(owner);

    const res = await post(app, { contentLanguage: "en" });

    await expect(res.text()).resolves.toContain("Site name");
    expect(completeSiteSetup).not.toHaveBeenCalled();
  });

  // A named site is never asked for one, so a name arriving anyway is not the
  // author renaming their site from the setup screen.
  it("leaves a named site's name alone", async () => {
    const { app, completeSiteSetup } = createSetupApp({
      ...owner,
      storedSiteName: "My Blog",
    });

    await post(app, { siteName: "Something Else", contentLanguage: "en" });

    expect(completeSiteSetup).toHaveBeenCalledWith(
      expect.objectContaining({ siteName: undefined, timeZone: undefined }),
      expect.anything(),
      expect.anything(),
    );
  });
});
