/**
 * Views wait here for a few seconds and leave as one write.
 *
 * Counting a view costs a database write, and a write is the one thing a
 * well-read page must not multiply. So a hit is added to an in-memory map and
 * the map is written out once, five seconds after its first hit: three
 * hundred readers opening one post from one link in those seconds are one row
 * with `count` three hundred. Under ordinary traffic nothing changes — a view
 * is still one write — and under a spike the writes fall by one or two orders
 * of magnitude.
 *
 * The map lives as long as the process that holds it: the whole run on Node,
 * an isolate's lifetime on Workers, where `keepAlive` hands the pending flush
 * to `waitUntil` so the isolate stays up for it. A process that dies between
 * a hit and its flush loses those few seconds of counts, which is the price
 * of never making a reader wait, and is accepted: the numbers are a guide,
 * not a ledger. The Node runtime flushes on `close()`.
 *
 * The buffer also holds the daily stop: once a flush reports the instance's
 * daily limit reached, hits are dropped until the next UTC day, when the
 * free-tier D1 write quota that the limit protects resets.
 */

/** How long a hit waits for company before the buffer is written out. */
export const VIEW_FLUSH_DELAY_MS = 5_000;

/** One reader opening one page, as the counter files it. */
export interface ViewHit {
  siteId: string;
  /** The site's calendar day, `YYYY-MM-DD`. */
  day: string;
  /** The site's hour, `YYYY-MM-DDTHH`, for today's chart. */
  hour: string;
  /** A post id, or the path of any other page. */
  page: string;
  /** The referring host, or `""`. */
  referrer: string;
}

/** A hit with the number of times it happened. */
export interface ViewCountEntry extends ViewHit {
  count: number;
}

/** What a sink reports back from writing a batch. */
export interface ViewRecordResult {
  /** The instance has recorded its daily limit of views; stop until tomorrow. */
  limitReached: boolean;
}

/** Where a flush goes, and how the runtime is kept alive for it. */
export interface ViewSink {
  record(entries: ViewCountEntry[]): Promise<ViewRecordResult>;
  /**
   * Hands the pending flush to the runtime so it outlives the response that
   * scheduled it. Workers pass `waitUntil`; Node needs nothing.
   */
  keepAlive?(promise: Promise<unknown>): void;
}

interface ScheduledFlush {
  timer: ReturnType<typeof setTimeout>;
  settle: () => void;
}

function entryKey(hit: ViewHit): string {
  return `${hit.siteId}\n${hit.hour}\n${hit.page}\n${hit.referrer}`;
}

function nextUtcMidnight(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  );
}

/**
 * Collects view hits and writes them out in batches.
 *
 * One instance per process is the point; tests construct their own with a
 * shorter delay and call `flush()` themselves.
 *
 * @example
 * ```ts
 * const buffer = new ViewBuffer();
 * buffer.add(hit, { record: (entries) => services.stats.record(entries, opts) });
 * // five seconds later, one write
 * ```
 */
export class ViewBuffer {
  readonly #delayMs: number;
  readonly #now: () => number;
  readonly #pending = new Map<string, ViewCountEntry>();
  #sink: ViewSink | null = null;
  #scheduled: ScheduledFlush | null = null;
  #pausedUntil = 0;

  /**
   * @param options.delayMs - How long the first hit waits before the flush
   * @param options.now - Clock in milliseconds, for tests
   */
  constructor(options: { delayMs?: number; now?: () => number } = {}) {
    this.#delayMs = options.delayMs ?? VIEW_FLUSH_DELAY_MS;
    this.#now = options.now ?? Date.now;
  }

  /** Hits waiting to be written, as distinct entries. */
  get size(): number {
    return this.#pending.size;
  }

  /** Whether the daily stop is in force right now. */
  get paused(): boolean {
    return this.#now() < this.#pausedUntil;
  }

  /**
   * Add one hit and make sure a flush is coming.
   *
   * The sink of the latest hit is the one the flush uses: every sink in one
   * process writes to the same database, so any of them will do.
   *
   * @param hit - The view
   * @param sink - Where the batch goes
   * @returns Nothing
   */
  add(hit: ViewHit, sink: ViewSink): void {
    if (this.paused) return;
    this.#sink = sink;

    const key = entryKey(hit);
    const entry = this.#pending.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      this.#pending.set(key, { ...hit, count: 1 });
    }

    if (this.#scheduled) return;

    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const timer = setTimeout(() => {
      this.#scheduled = null;
      void this.flush().finally(settle);
    }, this.#delayMs);
    // A pending flush must not hold a stopping Node process open; the runtime
    // drains the buffer on close instead.
    (timer as { unref?: () => void }).unref?.();
    this.#scheduled = { timer, settle };
    sink.keepAlive?.(done);
  }

  /**
   * Write out everything pending now.
   *
   * Never rejects: a failed write is logged and its hits are gone, because
   * nothing upstream can do anything with the failure.
   *
   * @returns Nothing, once the write has settled
   */
  async flush(): Promise<void> {
    const scheduled = this.#scheduled;
    if (scheduled) {
      this.#scheduled = null;
      clearTimeout(scheduled.timer);
    }

    const entries = [...this.#pending.values()];
    this.#pending.clear();
    const sink = this.#sink;

    try {
      if (entries.length === 0 || !sink) return;
      const { limitReached } = await sink.record(entries);
      if (limitReached && !this.paused) {
        this.#pausedUntil = nextUtcMidnight(this.#now());
        // eslint-disable-next-line no-console -- An operator should see why a day's counts stop.
        console.warn(
          `[Jant] View counting paused until ${new Date(this.#pausedUntil).toISOString()}: STATS_DAILY_LIMIT reached.`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console -- Background failures must be visible.
      console.error(`[Jant] View counting flush error: ${message}`);
    } finally {
      // The sink closes over a request's services and context; once nothing
      // waits for it, let it go. A hit added meanwhile brought its own.
      if (this.#sink === sink && this.#pending.size === 0) this.#sink = null;
      scheduled?.settle();
    }
  }
}

/** The process's buffer, shared by every request. */
export const viewBuffer = new ViewBuffer();
