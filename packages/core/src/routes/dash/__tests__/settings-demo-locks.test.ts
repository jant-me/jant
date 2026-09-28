/**
 * A demo site's credentials are public, so anything its settings can put in
 * front of other visitors stays locked: a script in Code Injection would run
 * for everyone until the nightly reset, and custom CSS would restyle the site
 * for everyone.
 *
 * The refusal has to reach the visitor. These requests carry the headers
 * Datastar actually sends: its `Accept` includes `application/json`, which
 * made the route answer a JSON 403 that Datastar drops, so the demo refused
 * every save without a word.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createI18n } from "../../../i18n/index.js";
import { errorHandler } from "../../../middleware/error-handler.js";
import { settingsRoutes } from "../settings.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function createSettingsApp(demoMode: boolean) {
  const set = vi.fn(async () => {});
  const remove = vi.fn(async () => {});

  const app = new Hono<Env>();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.env = {} as Bindings;
    c.set("services", {
      settings: { set, remove },
    } as unknown as AppVariables["services"]);
    c.set("allSettings", {});
    c.set("currentSite", {
      createdAt: 0,
      id: "sit_test",
      key: "demo",
      status: "active",
      updatedAt: 0,
    });
    c.set("isAuthenticated", true);
    c.set("appConfig", {
      demoMode,
      sitePathPrefix: "",
    } as AppVariables["appConfig"]);
    c.set("lang", "en");
    c.set("i18n", createI18n("en"));
    await next();
  });
  app.route("/settings", settingsRoutes);

  return { app, set };
}

/** A POST the way a Datastar form sends it. */
function post(app: Hono<Env>, path: string, body: Record<string, string>) {
  return app.request(path, {
    method: "POST",
    headers: {
      Accept: "text/event-stream, text/html, application/json",
      "Content-Type": "application/json",
      "Datastar-Request": "true",
    },
    body: JSON.stringify(body),
  });
}

describe("settings a demo site locks", () => {
  it("refuses Code Injection in demo mode", async () => {
    const { app, set } = createSettingsApp(true);

    const res = await post(app, "/settings/code-injection", {
      customHeadHtml: "<script>alert(1)</script>",
    });

    await expect(res.text()).resolves.toContain(
      "Code injection is off in demo mode",
    );
    expect(set).not.toHaveBeenCalled();
  });

  it("refuses custom CSS in demo mode", async () => {
    const { app, set } = createSettingsApp(true);

    const res = await post(app, "/settings/custom-css", {
      customCSS: "body { display: none }",
    });

    await expect(res.text()).resolves.toContain(
      "Custom CSS is off in demo mode",
    );
    expect(set).not.toHaveBeenCalled();
  });

  it("saves both on an ordinary site", async () => {
    const { app, set } = createSettingsApp(false);

    await post(app, "/settings/code-injection", {
      customHeadHtml: "<meta name=a>",
    });
    await post(app, "/settings/custom-css", { customCSS: "body {}" });

    expect(set).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["/settings/custom-css", "Custom CSS is off in demo mode"],
    ["/settings/code-injection", "Code injection is off in demo mode"],
    [
      "/settings/account/sessions/some-token/revoke",
      "Session management is off in demo mode",
    ],
    ["/settings/account/password", "Password changes are off in demo mode"],
    [
      "/settings/account/delete-account",
      "Account deletion is off in demo mode",
    ],
  ])("tells a Datastar form why %s refused", async (path, message) => {
    const { app } = createSettingsApp(true);

    const res = await post(app, path, {});

    // Datastar only patches a successful response into the page.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(message);
    expect(html).toContain("toast-error");
  });

  it("answers a script with a JSON 403", async () => {
    const { app } = createSettingsApp(true);

    const res = await app.request("/settings/custom-css", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ customCSS: "body {}" }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
