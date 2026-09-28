import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { getDevApiToken } from "../../lib/env.js";
import { getClientIp } from "../../lib/rate-limit.js";
import { hasValidLocalDevToken } from "../../middleware/auth.js";
import { isSafeInternalRedirect, toPublicPath } from "../../lib/url.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const DEFAULT_REDIRECT_PATH = "/settings";

function normalizeRedirectPath(path?: string): string {
  return isSafeInternalRedirect(path) ? path : DEFAULT_REDIRECT_PATH;
}

export const devAuthRoutes = new Hono<Env>();

devAuthRoutes.get("/__dev/login", async (c) => {
  const token = c.req.query("token");

  if (
    !hasValidLocalDevToken(
      c.req.url,
      c.req.header("host"),
      getClientIp(c),
      token,
      getDevApiToken(c.env),
    )
  ) {
    return c.notFound();
  }

  const email = c.var.appConfig.demoEmail;
  const password = c.var.appConfig.demoPassword;

  if (!email || !password) {
    return c.text(
      "Set DEMO_EMAIL and DEMO_PASSWORD before using /__dev/login.",
      500,
    );
  }

  try {
    const { headers } = await c.var.auth.api.signInEmail({
      returnHeaders: true,
      body: { email, password },
      headers: c.req.raw.headers,
    });

    const responseHeaders = new Headers(headers);
    responseHeaders.set(
      "Location",
      toPublicPath(
        normalizeRedirectPath(c.req.query("redirect")),
        c.var.appConfig.sitePathPrefix,
      ),
    );

    return new Response(null, {
      status: 302,
      headers: responseHeaders,
    });
  } catch {
    return c.text(
      "Dev login failed. Finish /setup once or run `mise run db-wrangler-rebuild-demo`, then retry.",
      500,
    );
  }
});
