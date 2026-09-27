/**
 * CORS Middleware
 *
 * Allows cross-origin API requests when `CORS_ORIGINS` is configured.
 *
 * - Not set → CORS disabled
 * - `*` → allow all origins
 * - Comma-separated origins → allow only those
 *   (e.g. `https://example.com,chrome-extension://abcdef`)
 */

import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { getCorsOrigins } from "../lib/env.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * Creates CORS middleware driven by the `CORS_ORIGINS` environment variable.
 *
 * @returns Hono middleware that applies CORS headers when configured
 *
 * @example
 * ```ts
 * app.use("/api/*", apiCors());
 * ```
 */
export function apiCors(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const origins = getCorsOrigins(c.env);
    if (!origins) {
      await next();
      return;
    }

    const handler = cors({
      origin: origins,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "MCP-Protocol-Version"],
      exposeHeaders: ["Content-Type", "MCP-Protocol-Version"],
      credentials: origins !== "*",
      maxAge: 86400,
    });

    return handler(c, next);
  };
}
