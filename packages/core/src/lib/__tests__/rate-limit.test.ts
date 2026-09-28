import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  checkRequestRateLimit,
  type RateLimiter,
  type RequestRateLimitResult,
} from "../rate-limit.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * Build a tiny Hono app that seeds just the slice of `c.var` the check
 * reads, and answers with the check's result — keeps each test independent
 * of the full `createTestApp` fixture.
 */
function buildApp(options: {
  limiter: RateLimiter;
  disabled?: boolean;
  key?: string;
}): Hono<Env> {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("rateLimiter", options.limiter);
    c.set("appConfig", {
      rateLimit: {
        disabled: options.disabled ?? false,
        searchPerMinute: 30,
      },
    } as AppVariables["appConfig"]);
    await next();
  });
  app.get("/", async (c) =>
    c.json(
      await checkRequestRateLimit(c, {
        name: "test",
        key: options.key,
        limit: 2,
        windowSec: 60,
      }),
    ),
  );
  return app;
}

/** Fake limiter that lets us script results without real timing. */
function scriptedLimiter(
  outcomes: Array<{ ok: boolean; retryAfterSec?: number }>,
) {
  const keys: string[] = [];
  let i = 0;
  const limiter: RateLimiter = {
    async check(key) {
      keys.push(key);
      return outcomes[i++] ?? { ok: true };
    },
  };
  return { limiter, keys: () => keys };
}

async function check(
  app: Hono<Env>,
  headers?: Record<string, string>,
): Promise<RequestRateLimitResult> {
  return (await app.request("/", { headers })).json();
}

describe("checkRequestRateLimit", () => {
  it("passes a request under the limit", async () => {
    const { limiter } = scriptedLimiter([{ ok: true }]);

    expect(await check(buildApp({ limiter }))).toEqual({ ok: true });
  });

  it("reports the limiter's wait when it rejects", async () => {
    const { limiter } = scriptedLimiter([{ ok: false, retryAfterSec: 42 }]);

    expect(await check(buildApp({ limiter }))).toEqual({
      ok: false,
      retryAfterSec: 42,
    });
  });

  it("falls back to the window size when retryAfterSec is missing", async () => {
    const { limiter } = scriptedLimiter([{ ok: false }]);

    expect(await check(buildApp({ limiter }))).toEqual({
      ok: false,
      retryAfterSec: 60,
    });
  });

  it("counts nothing when rateLimit.disabled is true", async () => {
    const { limiter, keys } = scriptedLimiter([{ ok: false }]);

    expect(await check(buildApp({ limiter, disabled: true }))).toEqual({
      ok: true,
    });
    expect(keys()).toEqual([]);
  });

  it("prefers cf-connecting-ip over x-forwarded-for for the bucket key", async () => {
    const { limiter, keys } = scriptedLimiter([{ ok: true }]);

    await check(buildApp({ limiter }), {
      "cf-connecting-ip": "1.2.3.4",
      "x-forwarded-for": "5.6.7.8",
    });
    expect(keys()).toEqual(["test:1.2.3.4"]);
  });

  it("uses the entry the nearest proxy added, not one the client sent", async () => {
    const { limiter, keys } = scriptedLimiter([{ ok: true }]);

    await check(buildApp({ limiter }), {
      "x-forwarded-for": "10.0.0.1, 10.0.0.2",
    });
    expect(keys()).toEqual(["test:10.0.0.2"]);
  });

  it("buckets by a key when one is given", async () => {
    const { limiter, keys } = scriptedLimiter([{ ok: true }]);

    await check(buildApp({ limiter, key: "owner@example.com" }), {
      "cf-connecting-ip": "1.2.3.4",
    });
    expect(keys()).toEqual(["test:owner@example.com"]);
  });
});
