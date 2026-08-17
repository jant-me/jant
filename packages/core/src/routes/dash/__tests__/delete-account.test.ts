/**
 * Tests for POST /settings/account/delete-account.
 *
 * The route is a POST returning a Datastar redirect, so it can be exercised
 * end to end without the SSR setup the settings pages need.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createI18n } from "../../../i18n/index.js";
import { settingsRoutes } from "../settings.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const CLEARED_SESSION_COOKIE =
  "better-auth.session_token=; Path=/; Max-Age=0; HttpOnly";

function createDeleteAccountTestApp() {
  const calls: string[] = [];

  const signOut = vi.fn(async () => {
    calls.push("signOut");
    return new Response(null, {
      headers: { "Set-Cookie": CLEARED_SESSION_COOKIE },
    });
  });
  const deleteAllData = vi.fn(async () => {
    calls.push("deleteAllData");
  });

  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.env = {} as Bindings;
    c.set("auth", { api: { signOut } } as unknown as AppVariables["auth"]);
    c.set("services", {
      auth: {
        validateDeleteCsrfToken: async (_token: string, sessionId: string) =>
          sessionId === "ses_test",
        deleteAllData,
      },
    } as unknown as AppVariables["services"]);
    c.set("storage", null);
    c.set("session", {
      session: { id: "ses_test" },
      user: { id: "usr_test" },
    } as AppVariables["session"]);
    c.set("isAuthenticated", true);
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
    } as AppVariables["appConfig"]);
    c.set("lang", "en");
    c.set("i18n", createI18n("en"));
    await next();
  });
  app.route("/settings", settingsRoutes);

  return { app, calls, signOut, deleteAllData };
}

function requestDelete(app: Hono<Env>) {
  return app.request("/settings/account/delete-account", {
    method: "POST",
    headers: { "x-csrf-token": "valid-token" },
  });
}

describe("POST /settings/account/delete-account", () => {
  it("clears the session cookie so the browser keeps no ticket to the deleted site", async () => {
    const { app } = createDeleteAccountTestApp();

    const res = await requestDelete(app);

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toContain(CLEARED_SESSION_COOKIE);
    await expect(res.text()).resolves.toContain("/setup");
  });

  it("signs out before the wipe, while the session row still exists", async () => {
    const { app, calls } = createDeleteAccountTestApp();

    await requestDelete(app);

    expect(calls).toEqual(["signOut", "deleteAllData"]);
  });

  it("still wipes the site when signing out fails", async () => {
    const { app, calls, signOut, deleteAllData } = createDeleteAccountTestApp();
    signOut.mockRejectedValueOnce(new Error("no session"));

    const res = await requestDelete(app);

    expect(res.status).toBe(200);
    expect(calls).toEqual(["deleteAllData"]);
    expect(deleteAllData).toHaveBeenCalledOnce();
  });
});
