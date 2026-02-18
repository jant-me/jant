import { describe, it, expect } from "vitest";
import { Hono } from "hono";

/**
 * Tests for the HTTPS redirect middleware in createApp().
 *
 * When SITE_URL is https, plain HTTP requests should be 301-redirected
 * to the equivalent HTTPS URL. This prevents browsers from silently
 * discarding __Secure- cookies on HTTP connections.
 */

function createApp(siteUrl?: string) {
  const app = new Hono();

  // Mirrors the HTTPS redirect middleware from app.tsx
  app.use("*", async (c, next) => {
    if (siteUrl?.startsWith("https://")) {
      const url = new URL(c.req.url);
      if (url.protocol === "http:") {
        url.protocol = "https:";
        return c.redirect(url.toString(), 301);
      }
    }
    await next();
  });

  app.get("/*", (c) => c.text("OK"));

  return app;
}

describe("HTTPS redirect middleware", () => {
  it("redirects HTTP to HTTPS when SITE_URL is https", async () => {
    const app = createApp("https://example.com");
    const res = await app.request("http://example.com/signin", {
      redirect: "manual",
    });
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://example.com/signin");
  });

  it("preserves query string in redirect", async () => {
    const app = createApp("https://example.com");
    const res = await app.request("http://example.com/page?foo=bar", {
      redirect: "manual",
    });
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe(
      "https://example.com/page?foo=bar",
    );
  });

  it("does not redirect HTTPS requests", async () => {
    const app = createApp("https://example.com");
    const res = await app.request("https://example.com/signin");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  it("does not redirect when SITE_URL is http", async () => {
    const app = createApp("http://example.com");
    const res = await app.request("http://example.com/signin");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  it("does not redirect when SITE_URL is not set", async () => {
    const app = createApp(undefined);
    const res = await app.request("http://example.com/signin");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });
});
