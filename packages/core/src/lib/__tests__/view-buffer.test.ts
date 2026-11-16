import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ViewBuffer,
  type ViewCountEntry,
  type ViewSink,
} from "../view-buffer.js";

const HIT = {
  siteId: "sit_test",
  day: "2026-11-08",
  hour: "2026-11-08T12",
  page: "pst_one",
  referrer: "example.com",
};

function sink(result = { limitReached: false }) {
  const record = vi.fn<(entries: ViewCountEntry[]) => Promise<typeof result>>(
    async () => result,
  );
  const keepAlive = vi.fn<(promise: Promise<unknown>) => void>();
  const target: ViewSink = { record, keepAlive };
  return { target, record, keepAlive };
}

describe("ViewBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sums the same page and referrer into one entry and writes once", async () => {
    const buffer = new ViewBuffer({ delayMs: 5_000 });
    const { target, record } = sink();

    for (let index = 0; index < 300; index++) buffer.add(HIT, target);
    buffer.add({ ...HIT, referrer: "" }, target);
    expect(buffer.size).toBe(2);
    expect(record).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]).toEqual([
      { ...HIT, count: 300 },
      { ...HIT, referrer: "", count: 1 },
    ]);
    expect(buffer.size).toBe(0);
  });

  // On Workers the isolate lives exactly as long as the promises handed to
  // `waitUntil`; the pending flush has to be one of them.
  it("hands the runtime one promise per scheduled flush, settled after the write", async () => {
    const buffer = new ViewBuffer({ delayMs: 1_000 });
    const { target, keepAlive } = sink();

    buffer.add(HIT, target);
    buffer.add(HIT, target);
    expect(keepAlive).toHaveBeenCalledOnce();

    let settled = false;
    void keepAlive.mock.calls[0]?.[0].then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("flushes on demand and settles the scheduled flush too", async () => {
    const buffer = new ViewBuffer({ delayMs: 60_000 });
    const { target, record, keepAlive } = sink();

    buffer.add(HIT, target);
    await buffer.flush();

    expect(record).toHaveBeenCalledOnce();
    await expect(keepAlive.mock.calls[0]?.[0]).resolves.toBeUndefined();
    // The cancelled timer must not write a second time.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(record).toHaveBeenCalledOnce();
  });

  it("stops counting until the next UTC day once the limit is reached", async () => {
    let now = Date.UTC(2026, 10, 8, 22);
    const buffer = new ViewBuffer({ delayMs: 0, now: () => now });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limited = sink({ limitReached: true });

    buffer.add(HIT, limited.target);
    await buffer.flush();
    expect(buffer.paused).toBe(true);
    expect(warn).toHaveBeenCalledOnce();

    buffer.add(HIT, limited.target);
    expect(buffer.size).toBe(0);

    now = Date.UTC(2026, 10, 9, 0, 0, 1);
    expect(buffer.paused).toBe(false);
    buffer.add(HIT, limited.target);
    expect(buffer.size).toBe(1);
  });

  it("logs a failed write and keeps going", async () => {
    const buffer = new ViewBuffer({ delayMs: 0 });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: ViewSink = {
      record: async () => {
        throw new Error("database unavailable");
      },
    };

    buffer.add(HIT, failing);
    await expect(buffer.flush()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      "[Jant] View counting flush error: database unavailable",
    );
    expect(buffer.size).toBe(0);
  });
});
