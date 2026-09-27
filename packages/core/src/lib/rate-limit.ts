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
 * On Cloudflare Workers, `cf-connecting-ip` is set by the edge and is
 * authoritative. On Node deployments we fall back to the leftmost
 * `x-forwarded-for` entry, which is the conventional client IP when the
 * app sits behind a single trusted proxy. When neither header is
 * available we return `"unknown"` so all such requests share a bucket —
 * preferable to skipping the rate limit entirely.
 *
 * Note: this helper does not verify proxy trust. It is used for DoS
 * protection, not authentication. If header-forgery resistance becomes
 * important, gate the `x-forwarded-for` branch on `shouldTrustProxy`.
 */
export function getClientIp(c: Context): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
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
}

/** Whether a request is under its limit, and how long to wait when it isn't. */
export type RequestRateLimitResult =
  { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Counts this request against its client's bucket and reports whether it is
 * under the limit.
 *
 * Buckets are per client IP (see {@link getClientIp}) and scoped by `name`.
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
    `${opts.name}:${getClientIp(c)}`,
    { limit: opts.limit, windowSec: opts.windowSec },
  );
  if (result.ok) return { ok: true };
  return { ok: false, retryAfterSec: result.retryAfterSec ?? opts.windowSec };
}
