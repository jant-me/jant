/**
 * Rate Limiting Abstraction
 *
 * Shared interface for per-key rate limiting. Runtimes provide their own
 * implementation: Cloudflare Workers uses a D1-backed sliding-window table
 * (ephemeral isolates can't hold memory state), while Node uses an
 * in-process Map (the process is persistent and avoids DB round-trips).
 *
 * Consumers depend only on this interface; they are runtime-agnostic.
 */

import type { Context } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";

type RateLimitContext = Context<{
  Bindings: Bindings;
  Variables: AppVariables;
}>;

export interface RateLimitCheckOptions {
  /** Max requests allowed within `windowSec`. */
  limit: number;
  /** Sliding window size in seconds. */
  windowSec: number;
}

export interface RateLimitResult {
  /** True when the request is under the limit (already counted). */
  ok: boolean;
  /**
   * When `ok` is false, suggested seconds the client should wait before
   * retrying. Implementations may return the full window as a safe default.
   */
  retryAfterSec?: number;
}

export interface RateLimiter {
  /**
   * Records a hit against `key` and reports whether the request is under
   * the configured limit. Implementations must be race-safe enough that
   * concurrent callers cannot durably exceed the limit.
   */
  check(key: string, opts: RateLimitCheckOptions): Promise<RateLimitResult>;
}

/**
 * Extracts the client IP from a Hono request context.
 *
 * On Cloudflare Workers, `cf-connecting-ip` is set by the edge and a client
 * can't forge it. On Node, the request handler has already pinned both
 * headers (see `withClientAddress` in `node/request-handler.ts`): without
 * `TRUST_PROXY` they hold the socket's address, and behind a trusted proxy
 * they hold what the proxy set. The last `x-forwarded-for` entry is the one
 * the nearest proxy added; earlier entries are whatever the client sent. When
 * neither header is available we return `"unknown"` so all such requests
 * share a bucket, which beats skipping the rate limit entirely.
 *
 * @param c - Hono context
 * @returns The client's IP address, or `"unknown"`
 *
 * @example
 * ```ts
 * // X-Forwarded-For: 198.51.100.1, 203.0.113.7
 * getClientIp(c); // "203.0.113.7"
 * ```
 */
export function getClientIp(c: {
  req: { header(name: string): string | undefined };
}): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) {
    const last = fwd.split(",").at(-1)?.trim();
    if (last) return last;
  }
  return "unknown";
}

/** A per-client limit on one surface. */
export interface RequestRateLimitOptions extends RateLimitCheckOptions {
  /**
   * Storage-key prefix scoping this limit (e.g. "search"). Keeps counters for
   * different surfaces independent when they share a storage backend.
   */
  name: string;
  /**
   * What the bucket belongs to, such as the email address a sign-in names.
   * Defaults to the client IP (see {@link getClientIp}).
   */
  key?: string;
}

/** Whether a request is under its limit, and how long to wait when it isn't. */
export type RequestRateLimitResult =
  { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Counts this request against its client's bucket and reports whether it is
 * under the limit.
 *
 * Buckets are per client IP (see {@link getClientIp}), or per `key` when one
 * is given, and scoped by `name`.
 * When `appConfig.rateLimit.disabled` is set, nothing is counted and every
 * request passes, so test and dev environments don't have to reason about
 * bucket state. The caller decides what an over-limit response looks like:
 * a page and an API answer differently.
 *
 * @param c - Hono context; reads `c.var.rateLimiter` and `c.var.appConfig`
 * @param opts - Bucket name, limit, and window
 * @returns `ok: false` with the seconds to wait when the client is over the limit
 *
 * @example
 * ```ts
 * const limit = await checkRequestRateLimit(c, {
 *   name: "search",
 *   limit: 30,
 *   windowSec: 60,
 * });
 * if (!limit.ok) c.header("Retry-After", String(limit.retryAfterSec));
 * ```
 */
export async function checkRequestRateLimit(
  c: RateLimitContext,
  opts: RequestRateLimitOptions,
): Promise<RequestRateLimitResult> {
  if (c.var.appConfig.rateLimit.disabled) return { ok: true };

  const result = await c.var.rateLimiter.check(
    `${opts.name}:${opts.key ?? getClientIp(c)}`,
    { limit: opts.limit, windowSec: opts.windowSec },
  );
  if (result.ok) return { ok: true };
  return { ok: false, retryAfterSec: result.retryAfterSec ?? opts.windowSec };
}
