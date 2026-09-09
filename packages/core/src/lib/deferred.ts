/**
 * Background work that outlives the HTTP response that started it.
 *
 * Some work must not be waited on: a Telegram webhook has to ACK before the
 * album it triggered is assembled, or Telegram serializes the next update in
 * that chat behind it; a Discover announcement has to leave the settings save
 * alone, because a directory being down is not a reason a save fails. Both
 * want the same thing — start it, answer the request, let it finish.
 *
 * The shape is small but every part of it is load-bearing, which is why it is
 * one function rather than four lines copied per call site:
 *
 * - **The promise carries its own handler.** Nothing is awaiting it, so a
 *   rejection has nobody to reject to. Left unhandled, Node ends the process.
 * - **`waitUntil` is optional and its accessor throws.** On Workers it keeps
 *   the isolate alive until the promise settles. Under Node and in tests
 *   Hono's `c.executionCtx` getter throws rather than returning undefined, so
 *   reaching for it needs a `try`, and the promise is simply left to the event
 *   loop.
 * - **Tests need a handle on it.** With no `waitUntil` there is nothing to
 *   await, so a test that has to assert on the result registers an array at
 *   `__pendingDeferred` on the env and gets every promise pushed into it.
 */

/**
 * An env binding carrying the test hook.
 *
 * Registered by a test that needs to `await` deferred work before asserting —
 * production bindings never have it, and the array is simply not found.
 */
export interface DeferredPendingEnv {
  __pendingDeferred?: Promise<unknown>[];
}

/**
 * Start work that must finish after the response has been sent.
 *
 * Never throws and never rejects: a failure is logged under `label` and goes
 * no further, because there is no caller left to tell.
 *
 * @param c - Request context, for the env binding and the runtime's
 *   background-work hook. A full Hono `Context` satisfies this.
 * @param label - What this work is, for the log line when it fails. A short
 *   subject in the sentence "`<label>` background error" — "Telegram",
 *   "Discover announcement".
 * @param work - The work itself. Its rejection is handled here.
 * @returns Nothing — the point is that the caller does not wait.
 * @example
 * ```ts
 * runDeferred(c, "Discover announcement", async () => {
 *   await services.settings.announceToDiscover({ endpoint, feedUrl });
 * });
 * ```
 */
export function runDeferred(
  c: {
    env: object;
    executionCtx?: { waitUntil: (promise: Promise<unknown>) => void };
  },
  label: string,
  work: () => Promise<void>,
): void {
  const promise = work().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console -- Background failures must be visible.
    console.error(`[Jant] ${label} background error: ${message}`);
  });

  try {
    c.executionCtx?.waitUntil(promise);
  } catch {
    // executionCtx not available (e.g. Node, tests) — the promise still runs.
  }

  const pending = (c.env as DeferredPendingEnv).__pendingDeferred;
  if (Array.isArray(pending)) {
    pending.push(promise);
  }
}
