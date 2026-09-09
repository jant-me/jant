import { afterEach, describe, expect, it, vi } from "vitest";
import { runDeferred, type DeferredPendingEnv } from "../deferred.js";

/** A context whose `executionCtx` throws on access, the way Hono's does. */
function contextWithoutExecutionCtx(env: object = {}) {
  return {
    env,
    get executionCtx(): { waitUntil: (promise: Promise<unknown>) => void } {
      throw new Error("This context has no ExecutionContext");
    },
  };
}

describe("runDeferred", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands the promise to waitUntil so a Worker stays alive for it", async () => {
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    let done = false;

    runDeferred({ env: {}, executionCtx: { waitUntil } }, "Test", async () => {
      done = true;
    });

    expect(waitUntil).toHaveBeenCalledOnce();
    await waitUntil.mock.calls[0]?.[0];
    expect(done).toBe(true);
  });

  // Hono's `c.executionCtx` is a throwing getter, not an undefined property,
  // so reaching for it at all is what has to be guarded.
  it("still runs the work when there is no ExecutionContext", async () => {
    const work = vi.fn(async () => {});

    runDeferred(contextWithoutExecutionCtx(), "Test", work);

    expect(work).toHaveBeenCalledOnce();
    await work.mock.results[0]?.value;
  });

  // The whole reason this helper exists: nothing awaits the promise, so an
  // unhandled rejection has nobody to reject to and ends a Node process.
  it("swallows and logs a failure instead of rejecting", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending: Promise<unknown>[] = [];
    const env: DeferredPendingEnv = { __pendingDeferred: pending };

    runDeferred(contextWithoutExecutionCtx(env), "Discover announcement", () =>
      Promise.reject(new Error("directory unreachable")),
    );

    await expect(pending[0]).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "[Jant] Discover announcement background error: directory unreachable",
    );
  });

  it("labels a non-Error rejection too", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending: Promise<unknown>[] = [];

    runDeferred(
      contextWithoutExecutionCtx({ __pendingDeferred: pending }),
      "Telegram",
      () => Promise.reject("boom"),
    );

    await pending[0];
    expect(error).toHaveBeenCalledWith(
      "[Jant] Telegram background error: boom",
    );
  });

  it("collects the promise only when a test registered the array", () => {
    const pending: Promise<unknown>[] = [];

    runDeferred(
      contextWithoutExecutionCtx({ __pendingDeferred: pending }),
      "Test",
      async () => {},
    );
    // A production binding carries no such array; nothing is collected and
    // nothing throws.
    runDeferred(contextWithoutExecutionCtx({}), "Test", async () => {});

    expect(pending).toHaveLength(1);
  });
});
