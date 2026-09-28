import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { errorHandler } from "../../../middleware/error-handler.js";
import { UnauthorizedError } from "../../../lib/errors.js";
import { createI18n } from "../../../i18n/index.js";
import { hostedSsoRoutes } from "../hosted-sso.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import type { HostedHandoffService } from "../../../services/hosted-handoff.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function createHostedSsoTestApp(options?: {
  hostedHandoff?: HostedHandoffService;
  hostedControlPlaneBaseUrl?: string;
  hostedControlPlaneProviderName?: string;
  secret?: string;
  /** The session the browser already carries, as `attachSession` found it. */
  sessionToken?: string;
}) {
  const app = new Hono<Env>();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.env = {
      HOSTED_CONTROL_PLANE_BASE_URL: options?.hostedControlPlaneBaseUrl,
      HOSTED_CONTROL_PLANE_PROVIDER_NAME:
        options?.hostedControlPlaneProviderName,
      HOSTED_CONTROL_PLANE_SSO_SECRET: options?.secret,
    } as Bindings;
    c.set("auth", {
      $context: Promise.resolve({
        authCookies: {
          sessionToken: {
            attributes: {
              httpOnly: true,
              path: "/",
              sameSite: "Lax",
              secure: false,
            },
            name: "better-auth.session_token",
          },
        },
        secret: "test-auth-secret",
      }),
    } as AppVariables["auth"]);
    c.set(
      "hostedHandoff",
      options?.hostedHandoff ??
        ({
          async completeFromSignedToken() {
            return {
              sessionToken: "test-session-token",
              userId: "usr_test",
              reused: false,
            };
          },
        } as HostedHandoffService),
    );
    c.set("currentSite", {
      createdAt: 0,
      id: "sit_test",
      key: "demo",
      status: "active",
      updatedAt: 0,
    });
    c.set("appConfig", {
      siteName: "Jant",
      sitePathPrefix: "",
    } as AppVariables["appConfig"]);
    c.set("lang", "en");
    c.set("i18n", createI18n("en"));
    c.set(
      "session",
      (options?.sessionToken
        ? { session: { token: options.sessionToken }, user: { id: "usr_test" } }
        : null) as AppVariables["session"],
    );
    await next();
  });
  app.route("/", hostedSsoRoutes);
  return app;
}

describe("hostedSsoRoutes", () => {
  it("returns 404 when the cloud SSO secret is not configured", async () => {
    const app = createHostedSsoTestApp();

    const response = await app.request("/__sso?token=test-token");

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("404 Not Found");
  });

  it("returns 400 when the sign-in token is missing", async () => {
    const app = createHostedSsoTestApp({
      secret: "cloud-sso-secret-cloud-sso-secret",
    });

    const response = await app.request("/__sso");

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Missing sign-in token.");
  });

  it("sets a session cookie and redirects after a successful handoff", async () => {
    const completeFromSignedToken = vi.fn(async () => ({
      sessionToken: "hand-off-session",
      userId: "usr_test",
      reused: false,
    }));
    const app = createHostedSsoTestApp({
      secret: "cloud-sso-secret-cloud-sso-secret",
      hostedHandoff: {
        completeFromSignedToken,
      },
    });

    const response = await app.request(
      "/__sso?token=test-token&redirect=/compose",
      {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh) Firefox/140.0" },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/compose");
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session_token=",
    );
    expect(completeFromSignedToken).toHaveBeenCalledWith({
      currentSiteId: "sit_test",
      token: "test-token",
      client: {
        userAgent: "Mozilla/5.0 (Macintosh) Firefox/140.0",
        ipAddress: "",
        sessionToken: null,
      },
    });
  });

  // The handoff creates its session outside any better-auth endpoint, so
  // better-auth has no request to take the device from: the route hands it
  // over, with the session the browser already holds so it can be kept.
  it("hands the browser's device and current session to the handoff", async () => {
    const completeFromSignedToken = vi.fn(async () => ({
      sessionToken: "existing-session",
      userId: "usr_test",
      reused: true,
    }));
    const app = createHostedSsoTestApp({
      secret: "cloud-sso-secret-cloud-sso-secret",
      hostedHandoff: { completeFromSignedToken },
      sessionToken: "existing-session",
    });

    const response = await app.request("/__sso?token=test-token", {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone) Safari/605.1.15",
        "X-Forwarded-For": "203.0.113.7",
      },
    });

    expect(response.status).toBe(302);
    expect(completeFromSignedToken).toHaveBeenCalledWith({
      currentSiteId: "sit_test",
      token: "test-token",
      client: {
        userAgent: "Mozilla/5.0 (iPhone) Safari/605.1.15",
        ipAddress: "203.0.113.7",
        sessionToken: "existing-session",
      },
    });
  });

  it("surfaces handoff failures as route responses instead of blank 500s", async () => {
    const app = createHostedSsoTestApp({
      secret: "cloud-sso-secret-cloud-sso-secret",
      hostedHandoff: {
        async completeFromSignedToken() {
          throw new UnauthorizedError(
            "This sign-in link has expired. Return to cloud-jant.localtest.me and try again.",
          );
        },
      },
    });

    const response = await app.request("/__sso?token=test-token");

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe(
      "This sign-in link has expired. Return to cloud-jant.localtest.me and try again.",
    );
  });

  it("renders an expired-link page with a clickable hosted control-plane link when available", async () => {
    const app = createHostedSsoTestApp({
      hostedControlPlaneBaseUrl: "https://cloud-jant.localtest.me",
      secret: "cloud-sso-secret-cloud-sso-secret",
      hostedHandoff: {
        async completeFromSignedToken() {
          throw new UnauthorizedError(
            "This sign-in link has expired. Return to cloud-jant.localtest.me and try again.",
          );
        },
      },
    });

    const response = await app.request("/__sso?token=test-token");

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("This Link Has Expired");
    expect(html).toContain("This sign-in link has expired. Return to");
    expect(html).toContain('href="https://cloud-jant.localtest.me"');
    expect(html).toContain(">cloud-jant.localtest.me<");
  });
});
