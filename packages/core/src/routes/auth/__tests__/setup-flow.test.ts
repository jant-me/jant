/**
 * The whole self-hosted setup, walked once with nothing mocked.
 *
 * Real services, a real better-auth, a real database: the other setup tests
 * each hold one seam still, and this one is here to catch what only shows up
 * when they are all moving — the session the first screen mints being the one
 * the second screen accepts, the status the first screen writes being the one
 * the second screen reads, and the site ending up named after neither of them
 * guessed.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { createAuth } from "../../../auth.js";
import { attachSession } from "../../../middleware/session.js";
import {
  settings as settingsTable,
  siteMembers,
  user,
} from "../../../db/schema.js";
import { setupRoutes } from "../setup.js";

const PASSWORD = "correct-horse-battery";

function createSetupApp(options: Parameters<typeof createTestApp>[0] = {}) {
  const { app, services, db } = createTestApp(options);

  // The helper installs a stub that answers every session question the same
  // way. Setup needs the real thing: it mints a session on the first screen and
  // has to be believed on the second.
  const auth = createAuth(db, {
    secret: "test-secret-with-enough-entropy-for-session-cookies",
    baseURL: "http://localhost",
    useSecureCookies: false,
  });
  app.use("*", async (c, next) => {
    c.set("auth", auth);
    await next();
  });
  app.use("*", attachSession());
  app.route("/", setupRoutes);

  return { app, services, db, auth };
}

function post(
  app: ReturnType<typeof createSetupApp>["app"],
  body: Record<string, unknown>,
  cookie?: string,
) {
  return app.request("/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** The session cookie a response minted, in the form a request sends back. */
function sessionCookie(res: Response): string {
  const cookie = res.headers
    .getSetCookie()
    .find((value) => value.includes("session_token="));
  expect(cookie).toBeDefined();
  return cookie!.split(";")[0]!;
}

async function readSettings(db: ReturnType<typeof createSetupApp>["db"]) {
  const rows = await db.select().from(settingsTable);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

describe("self-hosted setup, both screens", () => {
  it("walks an empty install to a finished site", async () => {
    const { app, db } = createSetupApp();

    const first = await app.request("/setup");
    await expect(first.text()).resolves.toContain("Setup · Step 1 of 2");

    const account = await post(app, {
      email: "owner@example.com",
      password: PASSWORD,
    });
    const cookie = sessionCookie(account);

    // Between the screens: an owner, a navigation profile, and no answers.
    const midway = await readSettings(db);
    expect(midway["ONBOARDING_STATUS"]).toBe("provisioned");
    expect(midway["SITE_NAME"]).toBeUndefined();

    // The session the first screen minted is the one the second screen trusts.
    const second = await app.request("/setup", { headers: { Cookie: cookie } });
    const secondHtml = await second.text();
    expect(secondHtml).toContain("Setup · Step 2 of 2");
    expect(secondHtml).toContain("setup-site-name");

    await post(
      app,
      {
        siteName: "My Blog",
        contentLanguage: "zh-Hans",
        language: "en-GB",
        timezone: "Asia/Shanghai",
        discover: true,
      },
      cookie,
    );

    const finished = await readSettings(db);
    expect(finished["ONBOARDING_STATUS"]).toBe("completed");
    expect(finished["SITE_NAME"]).toBe("My Blog");
    expect(finished["SITE_LANGUAGE"]).toBe("zh-Hans");
    expect(finished["TIME_ZONE"]).toBe("Asia/Shanghai");
    expect(finished["DISCOVER"]).toBe("latest");
    // Left following the content language. An English browser is what every
    // unconfigured machine reports, so it is no evidence against the language
    // the author just chose by hand one field above.
    expect(finished["DASHBOARD_LANGUAGE"]).toBeUndefined();

    // The account opened under the address, and the second screen renamed it.
    const [owner] = await db.select().from(user);
    expect(owner?.name).toBe("My Blog");
    expect(owner?.email).toBe("owner@example.com");
  });

  // A finished site must never offer the screen that opens the first account
  // again, to anyone, signed in or not.
  it("closes setup once the site is finished", async () => {
    const { app } = createSetupApp();

    const cookie = sessionCookie(
      await post(app, { email: "owner@example.com", password: PASSWORD }),
    );
    await post(app, { siteName: "My Blog", contentLanguage: "en" }, cookie);

    const page = await app.request("/setup", {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    expect(page.status).toBe(302);
    expect(page.headers.get("Location")).toBe("/");

    const submitted = await post(
      app,
      { email: "someone@example.com", password: PASSWORD },
      cookie,
    );
    expect(submitted.status).toBe(302);
  });

  // Losing the session between the screens is the failure the split invented.
  // The site is provisioned, so the setup screen refuses an unauthenticated
  // visitor — and `/signin` stays open for them, which is how they get back.
  it("hides the second screen from a lost session", async () => {
    const { app } = createSetupApp();

    await post(app, { email: "owner@example.com", password: PASSWORD });

    const res = await app.request("/setup", { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  // The failure that used to brick an install: the account is opened, standing
  // the site up then fails, and the site is left `pending` with a user row in
  // it. From there `createAuth` refuses every signup and the onboarding
  // middleware sends `/signin` and `/reset` back to this screen — so retrying
  // the screen has to be the way out.
  it("resumes a first screen that failed after opening the account", async () => {
    const { app, services, db } = createSetupApp();
    const provision = vi.spyOn(services.bootstrap, "provisionOwnerAccount");
    provision.mockRejectedValueOnce(new Error("D1 unavailable"));

    const failed = await post(app, {
      email: "owner@example.com",
      password: PASSWORD,
    });
    await expect(failed.text()).resolves.toContain("Couldn't create your");

    // The account outlived the failure, and the site did not advance.
    expect((await db.select().from(user)).length).toBe(1);
    expect(await services.settings.getOnboardingStatus()).toBe("pending");

    // Registration is closed to everyone now, this address included — which is
    // why the retry has to resume rather than create.
    const resumed = await post(app, {
      email: "owner@example.com",
      password: PASSWORD,
    });

    expect(await services.settings.getOnboardingStatus()).toBe("provisioned");
    const second = await app.request("/setup", {
      headers: { Cookie: sessionCookie(resumed) },
    });
    await expect(second.text()).resolves.toContain("Setup · Step 2 of 2");
    // Still one account: resuming picked the existing one up.
    expect((await db.select().from(user)).length).toBe(1);
  });

  it("refuses to resume on the wrong password", async () => {
    const { app, services, db } = createSetupApp();
    vi.spyOn(services.bootstrap, "provisionOwnerAccount").mockRejectedValueOnce(
      new Error("D1 unavailable"),
    );

    await post(app, { email: "owner@example.com", password: PASSWORD });
    const res = await post(app, {
      email: "owner@example.com",
      password: "not-the-password",
    });

    await expect(res.text()).resolves.toContain("Couldn't create your");
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(await services.settings.getOnboardingStatus()).toBe("pending");
  });

  // The reason a different address is not an escape hatch, and so the reason
  // resuming had to be built: the registration hook counts rows, not emails.
  it("will not open a second account to get around it", async () => {
    const { app, services, db } = createSetupApp();
    vi.spyOn(services.bootstrap, "provisionOwnerAccount").mockRejectedValueOnce(
      new Error("D1 unavailable"),
    );

    await post(app, { email: "owner@example.com", password: PASSWORD });
    const res = await post(app, {
      email: "someone-else@example.com",
      password: PASSWORD,
    });

    await expect(res.text()).resolves.toContain("Couldn't create your");
    expect((await db.select().from(user)).length).toBe(1);
    expect(await services.settings.getOnboardingStatus()).toBe("pending");
  });
});

// A hosted site's owner arrives through the control plane's handoff, never
// through this screen. The control plane creates each hosted site already
// provisioned, so a `pending` one is a site that lost its status somehow — and
// the database behind it holds every tenant's accounts. Signing in here with
// any of them must not come away owning the site.
describe("setup on a host-based install", () => {
  it("never makes an existing account the owner of a hosted site", async () => {
    const { app, services, db, auth } = createSetupApp({
      siteResolutionMode: "host-based",
    });
    // Another tenant's owner. Being the first account, it also closes
    // registration, as it is closed on any hosted database.
    await auth.api.signUpEmail({
      body: {
        name: "Other Tenant",
        email: "other@example.com",
        password: PASSWORD,
      },
    });

    const res = await post(app, {
      email: "other@example.com",
      password: PASSWORD,
    });

    await expect(res.text()).resolves.toContain("Couldn't create your");
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(await db.select().from(siteMembers)).toHaveLength(0);
    expect(await services.settings.getOnboardingStatus()).toBe("pending");
  });
});
