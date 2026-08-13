import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import {
  requireAuth,
  requireAuthApi,
  requireInternalAdminApi,
  isLocalHostname,
  hasValidLocalDevToken,
} from "../auth.js";
import { attachSession } from "../session.js";
import { errorHandler } from "../error-handler.js";
import { DEFAULT_APP_PORT } from "../../lib/env.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };
const LOCAL_API_URL = `http://localhost:${DEFAULT_APP_PORT}/api/data`;
const LOCAL_HOST = `127.0.0.1:${DEFAULT_APP_PORT}`;
const TEST_CURRENT_SITE = {
  createdAt: 0,
  id: "site-1",
  key: "default",
  status: "active",
  updatedAt: 0,
} as AppVariables["currentSite"];

function createTestHonoApp() {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("currentSite", TEST_CURRENT_SITE);
    await next();
  });
  return app;
}

function createMockAuth(authenticated: boolean) {
  return {
    api: {
      // `attachSession` reads with `returnHeaders: true` so it can write
      // better-auth's refreshed cookies back onto the response, which puts the
      // result in better-call's `{ headers, response }` shape.
      getSession: async () => ({
        headers: new Headers(),
        response: authenticated
          ? {
              user: { id: "user-1", email: "test@test.com", name: "Test" },
              session: { id: "session-1" },
            }
          : null,
      }),
    },
  } as AppVariables["auth"];
}

function createMockApiTokenService(validToken?: string) {
  const tokenId = "token-id-1";
  return {
    verify: vi.fn(async (raw: string) => (raw === validToken ? tokenId : null)),
    updateLastUsed: vi.fn(async () => {}),
    create: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    deleteAll: vi.fn(async () => 0),
  };
}

function createMockSiteMembers(hasMembership = true) {
  return {
    get: vi.fn(async () =>
      hasMembership
        ? {
            createdAt: 0,
            role: "owner",
            siteId: "site-1",
            updatedAt: 0,
            userId: "user-1",
          }
        : null,
    ),
    ensure: vi.fn(),
  };
}

describe("isLocalHostname", () => {
  it.each([
    ["localhost", true],
    ["127.0.0.1", true],
    ["::1", true],
    ["jant.localtest.me", true],
    ["sub.localtest.me", true],
    ["myblog.com", false],
    ["demo.jant.me", false],
    ["localtest.me.evil.com", false],
  ])("isLocalHostname(%s) → %s", (hostname, expected) => {
    expect(isLocalHostname(hostname)).toBe(expected);
  });
});

describe("hasValidLocalDevToken", () => {
  it("accepts a local Host header even when the canonical request URL is remote", () => {
    expect(
      hasValidLocalDevToken(
        "https://jant.me/api/posts",
        "127.0.0.1:8020",
        "jnt_dev",
        "jnt_dev",
      ),
    ).toBe(true);
  });

  it("falls back to the request URL hostname when Host is absent", () => {
    expect(
      hasValidLocalDevToken(
        "http://127.0.0.1:8020/api/posts",
        undefined,
        "jnt_dev",
        "jnt_dev",
      ),
    ).toBe(true);
  });

  it("rejects non-local hosts even with a matching token", () => {
    expect(
      hasValidLocalDevToken(
        "https://jant.me/api/posts",
        "jant.me",
        "jnt_dev",
        "jnt_dev",
      ),
    ).toBe(false);
  });
});

describe("requireAuth", () => {
  it("allows authenticated requests", async () => {
    const app = createTestHonoApp();
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(true));
      c.set("services", {
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/settings", requireAuth(), (c) => c.text("Settings"));

    const res = await app.request("/settings");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Settings");
  });

  it("redirects unauthenticated requests to /signin with the original path", async () => {
    const app = createTestHonoApp();
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(false));
      c.set("services", {
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/settings/general", requireAuth(), (c) => c.text("Settings"));

    const res = await app.request("/settings/general", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/signin?redirect=%2Fsettings%2Fgeneral",
    );
  });

  it("preserves query string when redirecting to /signin", async () => {
    const app = createTestHonoApp();
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(false));
      c.set("services", {
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/settings", requireAuth(), (c) => c.text("Settings"));

    const res = await app.request("/settings?tab=profile", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/signin?redirect=%2Fsettings%3Ftab%3Dprofile",
    );
  });

  it("does not add a redirect query when requireAuth targets a custom path", async () => {
    const app = createTestHonoApp();
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(false));
      c.set("services", {
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/settings", requireAuth("/login"), (c) => c.text("Settings"));

    const res = await app.request("/settings", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("surfaces a route handler's error instead of bouncing to signin", async () => {
    const app = createTestHonoApp();
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(true));
      c.set("services", {
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/settings", requireAuth(), () => {
      throw new Error("saving the post blew up");
    });

    // Rewriting this into a redirect reads to the author as being randomly
    // signed out, and throws away whatever they were editing.
    const res = await app.request("/settings", { redirect: "manual" });
    expect(res.status).toBe(500);
  });

  it("surfaces a failed membership lookup instead of bouncing to signin", async () => {
    const app = createTestHonoApp();
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(true));
      c.set("services", {
        siteMembers: {
          ...createMockSiteMembers(),
          get: vi.fn(async () => {
            throw new Error("database unavailable");
          }),
        },
      } as unknown as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/settings", requireAuth(), (c) => c.text("Settings"));

    // `siteMembers.get` resolves to `null` for "not a member", so a throw is
    // always infrastructure — never a reason to claim the user is signed out.
    const res = await app.request("/settings", { redirect: "manual" });
    expect(res.status).toBe(500);
  });
});

describe("requireAuthApi", () => {
  it("surfaces a route handler's error instead of answering 401", async () => {
    const app = createTestHonoApp();
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(true));
      c.set("services", {
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/api/data", requireAuthApi(), () => {
      throw new Error("upstream failed");
    });

    // A 401 here would tell the client the login expired and send the author
    // back to sign-in over what is really a server-side failure.
    const res = await app.request("/api/data");
    expect(res.status).toBe(500);
  });

  it("allows authenticated requests via session", async () => {
    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(true));
      c.set("services", {
        apiTokens: createMockApiTokenService(),
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/api/data", requireAuthApi(), (c) => c.json({ data: "secret" }));

    const res = await app.request("/api/data");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBe("secret");
  });

  it("returns 401 for unauthenticated requests without Bearer token", async () => {
    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(false));
      c.set("services", {
        apiTokens: createMockApiTokenService(),
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/api/data", requireAuthApi(), (c) => c.json({ data: "secret" }));

    const res = await app.request("/api/data");
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when getSession throws", async () => {
    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.set("auth", {
        api: {
          getSession: async () => {
            throw new Error("Session error");
          },
        },
      } as AppVariables["auth"]);
      c.set("services", {
        apiTokens: createMockApiTokenService(),
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/api/data", requireAuthApi(), (c) => c.json({ data: "secret" }));

    const res = await app.request("/api/data");
    expect(res.status).toBe(401);
  });

  it("allows requests with valid Bearer token when session auth fails", async () => {
    const validToken = "jnt_abc123";
    const mockApiTokens = createMockApiTokenService(validToken);

    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(false));
      c.set("services", {
        apiTokens: mockApiTokens,
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/api/data", requireAuthApi(), (c) => c.json({ data: "secret" }));

    const res = await app.request("/api/data", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBe("secret");

    expect(mockApiTokens.verify).toHaveBeenCalledWith(validToken);
    expect(mockApiTokens.updateLastUsed).toHaveBeenCalledWith("token-id-1");
  });

  it("returns 401 for invalid Bearer token", async () => {
    const mockApiTokens = createMockApiTokenService("jnt_valid");

    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(false));
      c.set("services", {
        apiTokens: mockApiTokens,
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/api/data", requireAuthApi(), (c) => c.json({ data: "secret" }));

    const res = await app.request("/api/data", {
      headers: { Authorization: "Bearer jnt_invalid" },
    });
    expect(res.status).toBe(401);

    expect(mockApiTokens.verify).toHaveBeenCalledWith("jnt_invalid");
  });

  it("prefers session auth over Bearer token", async () => {
    const mockApiTokens = createMockApiTokenService("jnt_valid");

    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(true));
      c.set("services", {
        apiTokens: mockApiTokens,
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/api/data", requireAuthApi(), (c) => c.json({ data: "secret" }));

    const res = await app.request("/api/data", {
      headers: { Authorization: "Bearer jnt_valid" },
    });
    expect(res.status).toBe(200);

    // Should not check the token since session auth succeeded
    expect(mockApiTokens.verify).not.toHaveBeenCalled();
  });

  it("allows DEV_API_TOKEN on localhost", async () => {
    const devToken = "jnt_dev_test123";
    const mockApiTokens = createMockApiTokenService();

    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.env = { ...c.env, DEV_API_TOKEN: devToken } as Bindings;
      c.set("auth", createMockAuth(false));
      c.set("services", {
        apiTokens: mockApiTokens,
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/api/data", requireAuthApi(), (c) => c.json({ data: "secret" }));

    const res = await app.request(LOCAL_API_URL, {
      headers: { Authorization: `Bearer ${devToken}` },
    });
    expect(res.status).toBe(200);

    // Should NOT hit DB verification
    expect(mockApiTokens.verify).not.toHaveBeenCalled();
  });

  it("rejects DEV_API_TOKEN on non-local hostname", async () => {
    const devToken = "jnt_dev_test123";
    const mockApiTokens = createMockApiTokenService();

    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.env = { ...c.env, DEV_API_TOKEN: devToken } as Bindings;
      c.set("auth", createMockAuth(false));
      c.set("services", {
        apiTokens: mockApiTokens,
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/api/data", requireAuthApi(), (c) => c.json({ data: "secret" }));

    const res = await app.request("https://myblog.com/api/data", {
      headers: { Authorization: `Bearer ${devToken}` },
    });
    expect(res.status).toBe(401);

    // Falls through to normal DB verification (which also fails)
    expect(mockApiTokens.verify).toHaveBeenCalledWith(devToken);
  });

  it("allows DEV_API_TOKEN on *.localtest.me", async () => {
    const devToken = "jnt_dev_test123";
    const mockApiTokens = createMockApiTokenService();

    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.env = { ...c.env, DEV_API_TOKEN: devToken } as Bindings;
      c.set("auth", createMockAuth(false));
      c.set("services", {
        apiTokens: mockApiTokens,
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/api/data", requireAuthApi(), (c) => c.json({ data: "secret" }));

    const res = await app.request("https://jant.localtest.me/api/data", {
      headers: { Authorization: `Bearer ${devToken}` },
    });
    expect(res.status).toBe(200);
    expect(mockApiTokens.verify).not.toHaveBeenCalled();
  });

  it("allows DEV_API_TOKEN when SITE_ORIGIN canonicalizes to a remote host", async () => {
    const devToken = "jnt_dev_test123";
    const mockApiTokens = createMockApiTokenService();

    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.env = {
        ...c.env,
        DEV_API_TOKEN: devToken,
        SITE_ORIGIN: "https://jant.me",
      } as Bindings;
      c.set("auth", createMockAuth(false));
      c.set("services", {
        apiTokens: mockApiTokens,
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.get("/api/data", requireAuthApi(), (c) => c.json({ data: "secret" }));

    const res = await app.request("https://jant.me/api/data", {
      headers: {
        Authorization: `Bearer ${devToken}`,
        Host: LOCAL_HOST,
      },
    });

    expect(res.status).toBe(200);
    expect(mockApiTokens.verify).not.toHaveBeenCalled();
  });
});

describe("requireInternalAdminApi", () => {
  it("returns 404 when the internal admin token is not configured", async () => {
    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.set("auth", createMockAuth(false));
      c.set("services", {
        apiTokens: createMockApiTokenService(),
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.post("/api/internal/demo", requireInternalAdminApi(), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request("/api/internal/demo", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns 401 for an invalid internal admin token", async () => {
    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.env = {
        ...c.env,
        INTERNAL_ADMIN_TOKEN: "internal-secret",
      } as Bindings;
      c.set("auth", createMockAuth(false));
      c.set("services", {
        apiTokens: createMockApiTokenService(),
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.post("/api/internal/demo", requireInternalAdminApi(), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request("/api/internal/demo", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(res.status).toBe(401);
  });

  it("allows requests with the configured internal admin token", async () => {
    const app = createTestHonoApp();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.env = {
        ...c.env,
        INTERNAL_ADMIN_TOKEN: "internal-secret",
      } as Bindings;
      c.set("auth", createMockAuth(false));
      c.set("services", {
        apiTokens: createMockApiTokenService(),
        siteMembers: createMockSiteMembers(),
      } as AppVariables["services"]);
      await next();
    });
    app.use("*", attachSession());
    app.post("/api/internal/demo", requireInternalAdminApi(), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request("/api/internal/demo", {
      method: "POST",
      headers: { Authorization: "Bearer internal-secret" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
