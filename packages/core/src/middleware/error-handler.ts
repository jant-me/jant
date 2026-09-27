/**
 * Global Error Handler
 *
 * Maps DomainError subclasses to HTTP responses.
 * API routes receive JSON; page routes fall through to Hono defaults.
 */

import type { ErrorHandler, NotFoundHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import {
  ConfigurationError,
  DomainError,
  NotFoundError,
  SiteUnavailableError,
  ValidationError,
} from "../lib/errors.js";
import { renderSiteUnavailablePage } from "../lib/site-unavailable-page.js";
import { dsToast } from "../lib/sse.js";
import { getRuntimeConfigurationErrorPage } from "../lib/startup-config.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/** What every JSON caller gets for an error no handler expected. */
const INTERNAL_ERROR_BODY = {
  error:
    "The server hit an error it didn't expect. Try again; the server log has the details.",
  code: "INTERNAL_ERROR",
};

export const errorHandler: ErrorHandler<Env> = (err, c) => {
  // API routes: always return JSON
  if (c.req.path.startsWith("/api/")) {
    if (err instanceof DomainError) {
      const body: Record<string, unknown> = {
        error: err.message,
        code: err.code,
      };

      if (err instanceof ValidationError && err.details) {
        body.details = err.details;
      }

      return c.json(body, err.statusCode as ContentfulStatusCode);
    }

    // Unknown API error
    // eslint-disable-next-line no-console -- Server error logging is intentional
    console.error("[Jant] Unhandled error:", err);
    return c.json(INTERNAL_ERROR_BODY, 500);
  }

  // Datastar requests: return toast
  if (c.req.header("datastar-request")) {
    if (err instanceof DomainError) {
      return dsToast(err.message, "error");
    }
    // eslint-disable-next-line no-console -- Server error logging is intentional
    console.error("[Jant] Unhandled error:", err);
    return dsToast("Something went wrong. Try refreshing the page.", "error");
  }

  // JSON-accepting requests (Lit bridges)
  if (c.req.header("accept")?.includes("application/json")) {
    if (err instanceof DomainError) {
      const body: Record<string, unknown> = {
        error: err.message,
        code: err.code,
      };
      if (err instanceof ValidationError && err.details)
        body.details = err.details;
      return c.json(body, err.statusCode as ContentfulStatusCode);
    }
    // eslint-disable-next-line no-console -- Server error logging is intentional
    console.error("[Jant] Unhandled error:", err);
    return c.json(INTERNAL_ERROR_BODY, 500);
  }

  // A suspended site: the host is real, so answer with a page that says so
  // instead of the generic 404 shell. 503 keeps the site's search index alive
  // while it can still be restored; `Retry-After` is deliberately omitted
  // because we can't promise when (or whether) it comes back.
  if (err instanceof SiteUnavailableError) {
    return c.html(renderSiteUnavailablePage(c.env), 503, {
      "Cache-Control": "no-store",
    });
  }

  // Non-API routes: map NotFoundError to Hono's built-in 404
  if (err instanceof NotFoundError) {
    return c.notFound();
  }

  if (err instanceof ConfigurationError) {
    // eslint-disable-next-line no-console -- Configuration failures must stay visible in server logs.
    console.error("[Jant] Configuration error:", err);
    return c.html(getRuntimeConfigurationErrorPage(err.message), 500);
  }

  // eslint-disable-next-line no-console -- Page-route error logging is intentional
  console.error("[Jant] Unhandled page error:", err);

  // Everything else: re-throw for Hono's default handling
  throw err;
};

/**
 * Answers a request no route matched, and every `c.notFound()`.
 *
 * `/api/*` gets the JSON error shape the API documents, so a client can read
 * `code` the same way for a missing path as for a missing record. Pages keep
 * Hono's plain 404.
 *
 * @example
 * app.notFound(notFoundHandler);
 */
export const notFoundHandler: NotFoundHandler<Env> = (c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json(
      {
        error: "Nothing here. Check the method and the path.",
        code: "NOT_FOUND",
      },
      404,
    );
  }
  return c.text("404 Not Found", 404);
};
