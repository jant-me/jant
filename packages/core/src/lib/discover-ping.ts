/**
 * Announcing a site to a Jant Discover directory.
 *
 * A directory cannot list a self-hosted site it has never heard of, and a site
 * that publishes quietly has no reason to be found. The ping closes that gap
 * with the smallest thing that works: one request, carrying one URL, sent only
 * when someone deliberately turns the feature on.
 *
 * It is not a heartbeat and not a publish notification. It never fires
 * periodically, never per post, and never while the setting is off. Whether a
 * site is listed is still decided by what its own feed says, which the
 * directory has to fetch and read for itself.
 *
 * This module is transport only. It reports what happened; recording it is the
 * settings service's job, because an owner who cannot see whether the
 * announcement got through has no way to tell "waiting" from "lost".
 */

/** How long to wait before giving up on one attempt. */
const PING_TIMEOUT_MS = 5_000;

/**
 * Attempts one announcement makes before it is left to the owner.
 *
 * Two, because the failure worth retrying automatically is the directory being
 * mid-deploy or answering a transient 5xx. Anything that survives a second
 * attempt — a blocked egress, a proxy eating the request, a directory that
 * moved — is not going to be fixed by a third, and the settings page offers a
 * Retry the owner can press when they have fixed it.
 */
const PING_ATTEMPTS = 2;

/** Wait between the two attempts. */
const PING_RETRY_DELAY_MS = 2_000;

/** What one announcement attempt came to. */
export interface DiscoverAnnounceOutcome {
  /** Unix seconds when the attempt finished. */
  at: number;
  /** The directory acknowledged it. */
  ok: boolean;
  /** The feed address that was sent. */
  feedUrl: string;
  /** HTTP status, when there was a response at all. */
  status?: number;
  /** Why it failed, for the owner to read. Absent on success. */
  error?: string;
}

/**
 * Tell the configured directory where this site's feed is.
 *
 * Resolves rather than throws: the caller runs this as background work behind
 * a settings save, which must not fail because a directory is down.
 *
 * @param input - The directory endpoint, the feed to announce, and the clock
 * @returns What the attempt came to, success or not
 * @example
 * ```ts
 * const outcome = await sendDiscoverPing({
 *   endpoint: "https://jant.me/api/discover/ping",
 *   feedUrl: "https://example.com/latest/feed",
 *   now: () => Math.floor(Date.now() / 1000),
 * });
 * ```
 */
export async function sendDiscoverPing(input: {
  endpoint: string;
  feedUrl: string;
  now: () => number;
  /** Injectable so tests do not sit through the retry delay. */
  sleep?: (ms: number) => Promise<void>;
}): Promise<DiscoverAnnounceOutcome> {
  const sleep =
    input.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let last: { status?: number; error: string } = {
    error: "The announcement was not attempted.",
  };

  for (let attempt = 1; attempt <= PING_ATTEMPTS; attempt += 1) {
    const result = await attemptPing(input.endpoint, input.feedUrl);
    if (result.ok) {
      return {
        at: input.now(),
        ok: true,
        feedUrl: input.feedUrl,
        status: result.status,
      };
    }
    last = {
      error: result.error,
      ...(result.status ? { status: result.status } : {}),
    };
    if (attempt < PING_ATTEMPTS) await sleep(PING_RETRY_DELAY_MS);
  }

  return {
    at: input.now(),
    ok: false,
    feedUrl: input.feedUrl,
    ...(last.status === undefined ? {} : { status: last.status }),
    error: last.error,
  };
}

async function attemptPing(
  endpoint: string,
  feedUrl: string,
): Promise<
  { ok: true; status: number } | { ok: false; status?: number; error: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

  try {
    // The feed URL and nothing else. No identity, no version, no counts: a
    // directory needs an address to fetch, and anything more would make this
    // telemetry.
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feed: feedUrl }),
      signal: controller.signal,
    });
    if (response.ok) return { ok: true, status: response.status };
    return {
      ok: false,
      status: response.status,
      error: `The directory answered ${response.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
