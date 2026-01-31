/**
 * Authentication Middleware
 *
 * Protects routes by requiring authentication
 */

import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../app.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * Middleware that requires authentication.
 * Redirects to signin page if not authenticated.
 */
export function requireAuth(redirectTo = "/signin"): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!c.var.auth) {
      return c.redirect(redirectTo);
    }

    try {
      const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });

      if (!session?.user) {
        return c.redirect(redirectTo);
      }

      await next();
    } catch {
      return c.redirect(redirectTo);
    }
  };
}

/**
 * Middleware for API routes that requires authentication.
 * Returns 401 if not authenticated.
 */
export function requireAuthApi(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!c.var.auth) {
      return c.json({ error: "Authentication not configured" }, 500);
    }

    try {
      const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });

      if (!session?.user) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      await next();
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }
  };
}
