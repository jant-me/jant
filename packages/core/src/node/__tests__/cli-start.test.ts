import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeOnSignal, exitOnRefusal } from "../../../bin/commands/start.js";
import { PendingMigrationsError } from "../../db/migration-status.js";

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

  // The refusal is what `docker compose logs` shows an operator whose update
  // skipped `jant migrate`; it has to say what to run, not a stack trace.
  it("exits with the message alone when the database needs migrations", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.fn();
    const refusal = new PendingMigrationsError(["0034_add_x"]);

    exitOnRefusal(refusal, { exit } as unknown as Pick<typeof process, "exit">);

    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(`Error: ${refusal.message}`);
  });

  it("leaves any other startup error to the caller", () => {
    const exit = vi.fn();

    exitOnRefusal(new Error("EADDRINUSE"), {
      exit,
    } as unknown as Pick<typeof process, "exit">);

    expect(exit).not.toHaveBeenCalled();
  });
});
