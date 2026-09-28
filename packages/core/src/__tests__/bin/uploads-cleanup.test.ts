import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../../bin/commands/uploads/cleanup.js";

const originalEnv = {
  INTERNAL_ADMIN_TOKEN: process.env.INTERNAL_ADMIN_TOKEN,
  SITE_ORIGIN: process.env.SITE_ORIGIN,
  SITE_PATH_PREFIX: process.env.SITE_PATH_PREFIX,
};

afterEach(() => {
  if (originalEnv.INTERNAL_ADMIN_TOKEN === undefined) {
    delete process.env.INTERNAL_ADMIN_TOKEN;
  } else {
    process.env.INTERNAL_ADMIN_TOKEN = originalEnv.INTERNAL_ADMIN_TOKEN;
  }

  if (originalEnv.SITE_ORIGIN === undefined) {
    delete process.env.SITE_ORIGIN;
  } else {
    process.env.SITE_ORIGIN = originalEnv.SITE_ORIGIN;
  }

  if (originalEnv.SITE_PATH_PREFIX === undefined) {
    delete process.env.SITE_PATH_PREFIX;
  } else {
    process.env.SITE_PATH_PREFIX = originalEnv.SITE_PATH_PREFIX;
  }

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function batch(fields: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      abortedMultipartUploads: 0,
      deletedSessions: 0,
      deletedOrphanMedia: 0,
      purgedStorageObjects: 0,
      done: true,
      ...fields,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function setUp(...responses: Response[]) {
  process.env.SITE_ORIGIN = "https://example.com";
  process.env.SITE_PATH_PREFIX = "/blog";
  process.env.INTERNAL_ADMIN_TOKEN = "internal-secret";
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  return { fetchMock, logSpy };
}

describe("jant uploads cleanup", () => {
  it("calls the internal uploads cleanup endpoint", async () => {
    const { fetchMock, logSpy } = setUp(
      batch({ abortedMultipartUploads: 1, deletedSessions: 3 }),
    );

    await run(["--limit", "25"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/blog/api/internal/uploads/cleanup",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer internal-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit: 25 }),
      },
    );
    expect(logSpy.mock.calls.map(([line]) => line)).toEqual([
      "Cleaning expired uploads for https://example.com/blog...",
      "Deleted sessions: 3",
      "Aborted multipart uploads: 1",
      "Purged storage objects: 0",
    ]);
  });

  it("runs batches until the server reports nothing left", async () => {
    const { fetchMock, logSpy } = setUp(
      batch({ deletedSessions: 20, done: false }),
      batch({ deletedSessions: 20, purgedStorageObjects: 4, done: false }),
      batch({ deletedSessions: 5 }),
    );

    await run([]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logSpy).toHaveBeenCalledWith("Deleted sessions: 45");
    expect(logSpy).toHaveBeenCalledWith("Purged storage objects: 4");
  });

  it("runs one batch with --once", async () => {
    const { fetchMock } = setUp(batch({ deletedSessions: 20, done: false }));

    await run(["--once"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops when a batch that isn't the last removes nothing", async () => {
    const { fetchMock } = setUp(batch({ done: false }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);

    await expect(run([])).rejects.toThrow("exit");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
