/**
 * A demo site's credentials are public, so anything its settings can put in
 * front of other visitors stays locked: a script in Code Injection would run
 * for everyone until the nightly reset, and custom CSS would restyle the site
 * for everyone.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createI18n } from "../../../i18n/index.js";
import { settingsRoutes } from "../settings.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function createSettingsApp(demoMode: boolean) {
  const set = vi.fn(async () => {});
  const remove = vi.fn(async () => {});

  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.env = {} as Bindings;
    c.set("services", {
      settings: { set, remove },
    } as unknown as AppVariables["services"]);
    c.set("allSettings", {});
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

function post(app: Hono<Env>, path: string, body: Record<string, string>) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Datastar-Request": "true" },
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
});
