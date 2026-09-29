import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeOnSignal } from "../../../bin/commands/start.js";

function fakeProcess() {
  const emitter = new EventEmitter();
  const exit = vi.fn();
  return {
    target: Object.assign(emitter, { exit }) as unknown as Pick<
      typeof process,
      "on" | "exit"
    >,
    emitter,
    exit,
  };
}

describe("jant start", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Docker stops a container with SIGTERM, and node as PID 1 ignores a
  // signal it has no handler for.
  it.each(["SIGTERM", "SIGINT"])(
    "closes the server and exits on %s",
    async (signal) => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const close = vi.fn(async () => {});
      const { target, emitter, exit } = fakeProcess();

      closeOnSignal({ close }, target);
      emitter.emit(signal, signal);
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

      expect(close).toHaveBeenCalledTimes(1);
    },
  );

  it("stops without waiting on a second signal", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const close = vi.fn(() => new Promise<void>(() => {}));
    const { target, emitter, exit } = fakeProcess();

    closeOnSignal({ close }, target);
    emitter.emit("SIGTERM", "SIGTERM");
    emitter.emit("SIGINT", "SIGINT");

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits with an error when closing fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const close = vi.fn(async () => {
      throw new Error("busy");
    });
    const { target, emitter, exit } = fakeProcess();

    closeOnSignal({ close }, target);
    emitter.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});
