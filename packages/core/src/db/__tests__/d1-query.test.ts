import { beforeEach, describe, expect, it, vi } from "vitest";

const { runLocalWranglerMock } = vi.hoisted(() => ({
  runLocalWranglerMock: vi.fn(),
}));

vi.mock("../../../bin/lib/wrangler-cli.js", () => ({
  runLocalWrangler: runLocalWranglerMock,
}));

const { executeD1, parseWranglerError, queryD1 } =
  await import("../../../bin/lib/d1-query.js");

function createWranglerError(stderr) {
  return Object.assign(new Error("Wrangler command failed"), {
    stderr,
    stdout: "",
  });
}

describe("d1-query Wrangler error parsing", () => {
  beforeEach(() => {
    runLocalWranglerMock.mockReset();
  });

  it("keeps Cloudflare note details in the surfaced error", () => {
    const output = JSON.stringify({
      error: {
        text: "API request failed.",
        notes: [{ text: "The given account is not valid [code: 7403]" }],
      },
    });

    expect(parseWranglerError(output)).toBe(
      "API request failed. (The given account is not valid [code: 7403])",
    );
  });

  it("retries transient fetch failures for D1 queries", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    runLocalWranglerMock
      .mockImplementationOnce(() => {
        throw createWranglerError("fetch failed");
      })
      .mockImplementationOnce(() =>
        JSON.stringify([
          {
            results: [{ count: 1 }],
            success: true,
          },
        ]),
      );

    const rows = queryD1("SELECT 1", "d1-remote", {
      retryAttempts: 2,
      retryDelayMs: 0,
    });

    expect(rows).toEqual([{ count: 1 }]);
    expect(runLocalWranglerMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("does not retry non-transient Wrangler errors", () => {
    runLocalWranglerMock.mockImplementationOnce(() => {
      throw createWranglerError(
        JSON.stringify({
          error: {
            text: "Authentication error.",
          },
        }),
      );
    });

    expect(() =>
      queryD1("SELECT 1", "d1-remote", {
        retryAttempts: 3,
        retryDelayMs: 0,
      }),
    ).toThrow("Wrangler error: Authentication error.");
    expect(runLocalWranglerMock).toHaveBeenCalledTimes(1);
  });

  it("allows tracked migrations to disable transient retries", () => {
    runLocalWranglerMock.mockImplementationOnce(() => {
      throw createWranglerError("fetch failed");
    });

    expect(() =>
      executeD1("CREATE TABLE replacement (id TEXT)", "d1-remote", {
        quiet: true,
        retryAttempts: 1,
        retryDelayMs: 0,
      }),
    ).toThrow("fetch failed");
    expect(runLocalWranglerMock).toHaveBeenCalledTimes(1);
  });

  it("keeps Wrangler target flags out of child-process options", () => {
    runLocalWranglerMock.mockReturnValue(
      JSON.stringify([{ results: [{ count: 1 }], success: true }]),
    );

    queryD1("SELECT 1", "d1-remote", {
      configPath: "/tmp/wrangler.toml",
      database: "CONTENT_DB",
      env: "preview",
      persistTo: "/tmp/d1",
      retryAttempts: 1,
    });

    expect(runLocalWranglerMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        "CONTENT_DB",
        "--config",
        "/tmp/wrangler.toml",
        "--env",
        "preview",
        "--persist-to",
        "/tmp/d1",
      ]),
      {},
    );
  });
});
