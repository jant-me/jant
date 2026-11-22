/**
 * MCP OAuth 2.1 API Routes
 *
 * - `POST /api/oauth/register` — Dynamic Client Registration (RFC 7591)
 * - `POST /api/oauth/token` — Authorization Code + PKCE (S256) token exchange
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { checkRequestRateLimit } from "../../lib/rate-limit.js";
import { validate } from "../../middleware/validate.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const oauthApiRoutes = new Hono<Env>();

const REGISTER_LIMIT_PER_HOUR = 30;
const REGISTER_WINDOW_SEC = 3600;
const TOKEN_LIMIT_PER_MIN = 30;

const OAuthRegisterSchema = z.object({
  client_name: z.string().trim().min(1).max(100).optional(),
  redirect_uris: z.array(z.string().trim().min(1)).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

oauthApiRoutes.post(
  "/register",
  validate("json", OAuthRegisterSchema),
  async (c) => {
    const rateLimit = await checkRequestRateLimit(c, {
      name: "oauth-register",
      limit: REGISTER_LIMIT_PER_HOUR,
      windowSec: REGISTER_WINDOW_SEC,
    });
    if (!rateLimit.ok) {
      c.header("Retry-After", String(rateLimit.retryAfterSec));
      return c.json(
        {
          error: "invalid_request",
          error_description: "Too many client registrations. Try again later.",
        },
        429,
      );
    }

    const body = c.req.valid("json");
    const clientName = body.client_name?.trim() || "MCP Client";

    try {
      const registered = await c.var.services.oauth.registerClient({
        name: clientName,
        redirectUris: body.redirect_uris,
      });

      return c.json(
        {
          client_id: registered.id,
          client_name: registered.name,
          redirect_uris: registered.redirectUris,
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          client_id_issued_at: registered.createdAt,
        },
        201,
        {
          "Cache-Control": "no-store",
        },
      );
    } catch (err) {
      return c.json(
        {
          error: "invalid_client_metadata",
          error_description:
            err instanceof Error ? err.message : "Invalid client metadata",
        },
        400,
      );
    }
  },
);

async function parseTokenRequestBody(c: {
  req: {
    header: (name: string) => string | undefined;
    text: () => Promise<string>;
  };
}): Promise<Record<string, string>> {
  const contentType = (c.req.header("content-type") ?? "").toLowerCase();
  const raw = await c.req.text();
  if (!raw.trim()) return {};

  if (contentType.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(
          parsed as Record<string, unknown>,
        )) {
          if (typeof value === "string") result[key] = value;
        }
        return result;
      }
    } catch {
      return {};
    }
    return {};
  }

  const params = new URLSearchParams(raw);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

oauthApiRoutes.post("/token", async (c) => {
  const rateLimit = await checkRequestRateLimit(c, {
    name: "oauth-token",
    limit: TOKEN_LIMIT_PER_MIN,
    windowSec: 60,
  });
  if (!rateLimit.ok) {
    c.header("Retry-After", String(rateLimit.retryAfterSec));
    return c.json(
      {
        error: "invalid_request",
        error_description: "Too many token requests. Try again shortly.",
      },
      429,
      { "Cache-Control": "no-store", Pragma: "no-cache" },
    );
  }

  const params = await parseTokenRequestBody(c);
  const grantType = params.grant_type;

  if (grantType !== "authorization_code") {
    return c.json(
      {
        error: "unsupported_grant_type",
        error_description: "Only grant_type=authorization_code is supported.",
      },
      400,
      { "Cache-Control": "no-store", Pragma: "no-cache" },
    );
  }

  const code = params.code ?? "";
  const clientId = params.client_id ?? "";
  const redirectUri = params.redirect_uri ?? "";
  const codeVerifier = params.code_verifier ?? "";

  if (!code || !clientId || !redirectUri || !codeVerifier) {
    return c.json(
      {
        error: "invalid_request",
        error_description:
          "code, client_id, redirect_uri, and code_verifier are required.",
      },
      400,
      { "Cache-Control": "no-store", Pragma: "no-cache" },
    );
  }

  const exchanged = await c.var.services.oauth.exchangeAuthorizationCode({
    code,
    clientId,
    redirectUri,
    codeVerifier,
  });

  if (!exchanged) {
    return c.json(
      {
        error: "invalid_grant",
        error_description:
          "Authorization code is invalid, expired, already used, or failed PKCE verification.",
      },
      400,
      { "Cache-Control": "no-store", Pragma: "no-cache" },
    );
  }

  return c.json(
    {
      access_token: exchanged.accessToken,
      token_type: exchanged.tokenType,
      scope: exchanged.scope,
    },
    200,
    {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  );
});
