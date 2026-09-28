import { Hono } from "hono";
import { setSignedCookie } from "hono/cookie";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import {
  getHostedControlPlaneBaseUrl,
  getHostedControlPlaneProviderLabel,
  getHostedControlPlaneSsoSecret,
} from "../../lib/env.js";
import { DomainError, NotFoundError } from "../../lib/errors.js";
import { getClientIp } from "../../lib/rate-limit.js";
import { isSafeInternalRedirect, toPublicPath } from "../../lib/url.js";
import { renderHostedSsoExpiredPage } from "./hosted-sso-expired-page.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const DEFAULT_REDIRECT_PATH = "/settings";
const EXPIRED_SIGNIN_LINK_MESSAGE = "This sign-in link has expired.";

function normalizeRedirectPath(path?: string): string {
  return isSafeInternalRedirect(path) ? path : DEFAULT_REDIRECT_PATH;
}

function getHostedControlPlaneReturnTarget(env: object | undefined | null): {
  providerLabel: string;
  providerUrl: string;
} | null {
  const providerUrl = getHostedControlPlaneBaseUrl(env);
  if (!providerUrl) {
    return null;
  }

  try {
    return {
      providerLabel:
        getHostedControlPlaneProviderLabel(env) ??
        new URL(providerUrl).hostname,
      providerUrl,
    };
  } catch {
    return null;
  }
}

export const hostedSsoRoutes = new Hono<Env>();

hostedSsoRoutes.get("/__sso", async (c) => {
  if (!getHostedControlPlaneSsoSecret(c.env)) {
    throw new NotFoundError("Hosted sign-in endpoint");
  }

  const token = c.req.query("token");
  if (!token) {
    return c.text("Missing sign-in token.", 400);
  }

  try {
    const clientIp = getClientIp(c);
    const result = await c.var.hostedHandoff.completeFromSignedToken({
      currentSiteId: c.var.currentSite.id,
      token,
      client: {
        userAgent: c.req.header("User-Agent") ?? "",
        ipAddress: clientIp === "unknown" ? "" : clientIp,
        sessionToken: c.var.session?.session.token ?? null,
      },
    });

    const authContext = await c.var.auth.$context;
    await setSignedCookie(
      c,
      authContext.authCookies.sessionToken.name,
      result.sessionToken,
      authContext.secret,
      authContext.authCookies.sessionToken.attributes,
    );

    return c.redirect(
      toPublicPath(
        normalizeRedirectPath(c.req.query("redirect")),
        c.var.appConfig.sitePathPrefix,
      ),
    );
  } catch (error) {
    if (error instanceof DomainError) {
      if (
        error.statusCode === 401 &&
        error.message.startsWith(EXPIRED_SIGNIN_LINK_MESSAGE)
      ) {
        const returnTarget = getHostedControlPlaneReturnTarget(c.env);

        if (returnTarget) {
          return c.html(
            renderHostedSsoExpiredPage(c, returnTarget),
            error.statusCode,
          );
        }
      }

      return c.text(
        error.message,
        error.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500,
      );
    }

    throw error;
  }
});
