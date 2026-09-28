import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { devAuthRoutes } from "../dev.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function createApp(options?: {
  demoEmail?: string;
  demoPassword?: string;
  devToken?: string;
  signInError?: boolean;
}) {
  const signInEmail = vi.fn(async () => {
    if (options?.signInError) {
      throw new Error("sign-in failed");
    }

    return {
      headers: new Headers({
        "set-cookie":
          "better-auth.session_token=signed-token; Path=/; HttpOnly",
      }),
    };
  });

  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    c.env = {
      SITE_ORIGIN: "http://localhost:19020",
      SITE_PATH_PREFIX: "",
      DEV_API_TOKEN: options?.devToken ?? "jnt_dev_test123",
    } as Bindings;

    c.set("appConfig", {
      demoEmail: options?.demoEmail ?? "debug@jant.test",
      demoPassword: options?.demoPassword ?? "jant-dev-debug-login",
      sitePathPrefix: "",
    } as AppVariables["appConfig"]);
    c.set("auth", {
      api: {
        signInEmail,
      },
    } as AppVariables["auth"]);

    await next();
  });

  app.route("/", devAuthRoutes);

  return { app, signInEmail };
}

describe("devAuthRoutes", () => {
  it("signs in with demo credentials on a local hostname", async () => {
    const { app, signInEmail } = createApp();

    const res = await app.request(
      "http://jant.localtest.me/__dev/login?token=jnt_dev_test123&redirect=/compose",
      {
        redirect: "manual",
      },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/compose");
    expect(res.headers.get("set-cookie")).toContain(
      "better-auth.session_token=signed-token",
    );
    expect(signInEmail).toHaveBeenCalledWith({
      returnHeaders: true,
      body: {
        email: "debug@jant.test",
        password: "jant-dev-debug-login",
      },
      headers: expect.any(Headers),
    });
  });

  it("returns 404 when the token is missing or invalid", async () => {
    const { app, signInEmail } = createApp();

    const res = await app.request("http://jant.localtest.me/__dev/login", {
      redirect: "manual",
    });

    expect(res.status).toBe(404);
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("returns 404 on non-local hostnames even with the right token", async () => {
    const { app, signInEmail } = createApp();

    const res = await app.request(
      "https://example.com/__dev/login?token=jnt_dev_test123",
      {
        redirect: "manual",
      },
    );

    expect(res.status).toBe(404);
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it.each(["//evil.com", "/%5Cevil.com"])(
    "falls back to /settings for the off-site target %s",
    async (target) => {
      const { app } = createApp();

      const res = await app.request(
        `http://jant.localtest.me/__dev/login?token=jnt_dev_test123&redirect=${target}`,
        {
          redirect: "manual",
        },
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/settings");
    },
  );

  it("returns 500 when demo credentials are not configured", async () => {
    const { app, signInEmail } = createApp({ demoEmail: "", demoPassword: "" });

    const res = await app.request(
      "http://jant.localtest.me/__dev/login?token=jnt_dev_test123",
      {
        redirect: "manual",
      },
    );

    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Set DEMO_EMAIL and DEMO_PASSWORD");
    expect(signInEmail).not.toHaveBeenCalled();
  });
});
