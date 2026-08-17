import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";

vi.mock("../../lib/build-env.js", () => ({
  IS_VITE_DEV: false,
}));

const { secureHeadersMiddleware } = await import("../secure-headers.js");

type Env = { Bindings: Bindings; Variables: AppVariables };

describe("secureHeadersMiddleware", () => {
  it("allows broad image and media sources in CSP", async () => {
    const app = new Hono<Env>();

    app.use("*", async (_c, next) => {
      await next();
    });
    app.use("*", secureHeadersMiddleware());
    app.get("/", (c) => c.text("ok"));

    const response = await app.request("/");
    const csp = response.headers.get("content-security-policy");

    expect(csp).toContain("img-src 'self' data: blob: https: http:");
    expect(csp).toContain("media-src 'self' data: blob: https: http:");
  });

  it("allows the configured S3-compatible endpoint for browser direct uploads", async () => {
    const app = new Hono<Env>();

    app.use("*", async (_c, next) => {
      await next();
    });
    app.use("*", secureHeadersMiddleware());
    app.get("/", (c) => c.text("ok"));

    const response = await app.request("/", undefined, {
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT:
        "https://03e7294bdb3750ed5a0d6afef6d770e4.r2.cloudflarestorage.com",
      S3_BUCKET: "jant-cloud-media-dev",
    } as Bindings);
    const csp = response.headers.get("content-security-policy");

    expect(csp).toContain(
      "connect-src 'self' https://03e7294bdb3750ed5a0d6afef6d770e4.r2.cloudflarestorage.com",
    );
  });

  it("allows the bucket hostname for AWS S3 direct uploads", async () => {
    const app = new Hono<Env>();

    app.use("*", async (_c, next) => {
      await next();
    });
    app.use("*", secureHeadersMiddleware());
    app.get("/", (c) => c.text("ok"));

    const response = await app.request("/", undefined, {
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://s3.us-east-1.amazonaws.com",
      S3_BUCKET: "jant-media",
    } as Bindings);
    const csp = response.headers.get("content-security-policy");

    expect(csp).toContain(
      "connect-src 'self' https://s3.us-east-1.amazonaws.com https://jant-media.s3.us-east-1.amazonaws.com",
    );
  });

  it("adds ASSET_BASE_URL origin to script-src, style-src, and font-src", async () => {
    const app = new Hono<Env>();

    app.use("*", async (_c, next) => {
      await next();
    });
    app.use("*", secureHeadersMiddleware());
    app.get("/", (c) => c.text("ok"));

    const response = await app.request("/", undefined, {
      ASSET_BASE_URL: "https://cdn.example.com",
    } as Bindings);
    const csp = response.headers.get("content-security-policy");

    expect(csp).toContain(
      "script-src 'self' 'unsafe-eval' blob: https://cdn.example.com",
    );
    expect(csp).toContain(
      "style-src 'self' 'unsafe-inline' https://cdn.example.com",
    );
    expect(csp).toContain("font-src 'self' https://cdn.example.com");
  });

  it("keeps public pages embeddable with a smaller header set", async () => {
    const app = new Hono<Env>();

    app.use("*", async (_c, next) => {
      await next();
    });
    app.use("*", secureHeadersMiddleware());
    app.get("/", (c) => c.text("ok"));

    const response = await app.request("/");
    const csp = response.headers.get("content-security-policy");

    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("cross-origin-opener-policy")).toBeNull();
    expect(response.headers.get("cross-origin-resource-policy")).toBeNull();
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    // Public pages omit frame-ancestors so the site can be embedded elsewhere,
    // and they open https: in script/frame/connect-src so author-injected
    // analytics, embeds, and code-injection HTML can run.
    expect(csp).not.toContain("frame-ancestors");
    expect(csp).toContain("frame-src 'self' https:");
    expect(csp).toContain("script-src 'self' 'unsafe-eval' blob: https:");
  });

  it("blocks protected pages from being embedded in iframes", async () => {
    const app = new Hono<Env>();

    app.use("*", async (_c, next) => {
      await next();
    });
    app.use("*", secureHeadersMiddleware());
    app.get("/settings", (c) => c.text("ok"));

    const response = await app.request("/settings");
    const csp = response.headers.get("content-security-policy");

    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("does not relax script-src when no code injection is configured", async () => {
    const app = new Hono<Env>();
    const settings = {
      get: vi.fn(async () => null as string | null),
    };

    app.use("*", async (c, next) => {
      c.set("services", { settings } as AppVariables["services"]);
      await next();
    });
    app.use("*", secureHeadersMiddleware());
    app.get("/", (c) => c.text("ok"));

    const response = await app.request("/");
    const csp = response.headers.get("content-security-policy") ?? "";

    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("script-src 'self' 'unsafe-eval' blob: https:");
  });

  it("relaxes script-src with 'unsafe-inline' when code injection is set", async () => {
    const app = new Hono<Env>();
    const settings = {
      get: vi.fn(async (key: string) => {
        if (key === "CUSTOM_HEAD_HTML")
          return "<script>console.log('hi')</script>";
        return null;
      }),
    };

    app.use("*", async (c, next) => {
      c.set("services", { settings } as AppVariables["services"]);
      await next();
    });
    app.use("*", secureHeadersMiddleware());
    app.get("/", (c) => c.text("ok"));

    const response = await app.request("/");
    const csp = response.headers.get("content-security-policy");

    expect(csp).toContain(
      "script-src 'self' 'unsafe-eval' blob: 'unsafe-inline' https:",
    );
  });

  it("keeps script-src tight on frame-protected paths regardless of injection", async () => {
    const app = new Hono<Env>();
    const settings = {
      get: vi.fn(async (key: string) => {
        if (key === "CUSTOM_HEAD_HTML") return "<script>x()</script>";
        return null;
      }),
    };

    app.use("*", async (c, next) => {
      c.set("services", { settings } as AppVariables["services"]);
      await next();
    });
    app.use("*", secureHeadersMiddleware());
    app.get("/settings", (c) => c.text("ok"));

    const response = await app.request("/settings");
    const csp = response.headers.get("content-security-policy") ?? "";

    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    // Settings lookup should be skipped entirely on frame-protected paths.
    expect(settings.get).not.toHaveBeenCalled();
  });

  it("skips the settings lookup on static asset paths", async () => {
    const app = new Hono<Env>();
    const settings = {
      get: vi.fn(async () => null as string | null),
    };

    app.use("*", async (c, next) => {
      c.set("services", { settings } as AppVariables["services"]);
      await next();
    });
    app.use("*", secureHeadersMiddleware());
    app.get("/media/foo.jpg", (c) => c.text("ok"));
    app.get("/favicon.ico", (c) => c.text("ok"));

    await app.request("/media/foo.jpg");
    await app.request("/favicon.ico");

    expect(settings.get).not.toHaveBeenCalled();
  });
});
