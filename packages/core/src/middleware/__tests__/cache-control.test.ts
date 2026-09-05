import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { defaultCacheControl } from "../cache-control.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function buildApp(isAuthenticated = false): Hono<Env> {
  const app = new Hono<Env>();
  // Stands in for `attachSession()`, which runs before this middleware and is
  // what puts `isAuthenticated` on the context.
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", isAuthenticated);
    await next();
  });
  app.use("*", defaultCacheControl());

  // Un-annotated dynamic page — the common case.
  app.get("/", (c) => c.html("<h1>home</h1>"));

  // Route that declares its own public cache policy (e.g. a feed).
  app.get("/feed", (c) =>
    c.body("<feed/>", 200, { "Cache-Control": "public, max-age=180" }),
  );

  // Route that already opts out explicitly.
  app.get("/api/thing", (c) =>
    c.json({ ok: true }, 200, { "Cache-Control": "no-store" }),
  );

  return app;
}

describe("defaultCacheControl", () => {
  it("lets an anonymous page stay in the browser's back/forward cache", async () => {
    // `no-store` would disable it, making the back button re-request and
    // re-render a page that is the same for everyone anyway. `private` is
    // what keeps shared caches out, and it is still here.
    const response = await buildApp().request("/");
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("keeps a signed-in page out of every cache", async () => {
    // The back/forward cache restores a snapshot without asking the server,
    // so an authenticated view would survive signing out.
    const response = await buildApp(true).request("/");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("never allows a shared cache to store a dynamic page", async () => {
    for (const authed of [false, true]) {
      const value =
        (await buildApp(authed).request("/")).headers.get("Cache-Control") ??
        "";
      expect(value).toContain("private");
      expect(value).not.toContain("public");
    }
  });

  it("leaves an explicit public cache policy untouched", async () => {
    const response = await buildApp().request("/feed");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=180");
  });

  it("leaves an explicit opt-out untouched", async () => {
    const response = await buildApp().request("/api/thing");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("defaults not-found responses too", async () => {
    const response = await buildApp().request("/missing");
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});
