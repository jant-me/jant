import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../../bin/commands/posts/rebuild-html.js";
import { POST_BODY_HTML_VERSION } from "../../lib/post-body-html.js";

const originalEnv = {
  INTERNAL_ADMIN_TOKEN: process.env.INTERNAL_ADMIN_TOKEN,
  SITE_ORIGIN: process.env.SITE_ORIGIN,
  SITE_PATH_PREFIX: process.env.SITE_PATH_PREFIX,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function batchResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      processed: 1,
      wouldRebuild: 1,
      rebuilt: 1,
      wouldUpgradeFootnotes: 0,
      upgradedFootnotes: 0,
      skipped: 0,
      conflicted: 0,
      failed: 0,
      failures: [],
      nextCursor: null,
      done: true,
      targetVersion: POST_BODY_HTML_VERSION,
      ...overrides,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("jant posts rebuild-html", () => {
  it("paginates the current site and preserves dry-run mode", async () => {
    process.env.INTERNAL_ADMIN_TOKEN = "internal-secret";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        batchResponse({
          processed: 2,
          wouldRebuild: 2,
          rebuilt: 0,
          nextCursor: "pst_cursor",
          done: false,
        }),
      )
      .mockResolvedValueOnce(
        batchResponse({ processed: 1, rebuilt: 0, wouldRebuild: 1 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await run([
      "--url",
      "https://example.com/blog",
      "--limit",
      "2",
      "--dry-run",
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://example.com/blog/api/internal/posts/body-html/rebuild",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer internal-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit: 2, dryRun: true }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://example.com/blog/api/internal/posts/body-html/rebuild",
      expect.objectContaining({
        body: JSON.stringify({
          limit: 2,
          cursor: "pst_cursor",
          dryRun: true,
        }),
      }),
    );
  });

  it("targets one explicit managed site without fleet-wide discovery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(batchResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await run([
      "--url",
      "https://core.example.com",
      "--site",
      "sit_managed",
      "--token",
      "secret",
      "--once",
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://core.example.com/api/internal/sites/sit_managed/posts/body-html/rebuild",
      expect.objectContaining({
        body: JSON.stringify({ limit: 50 }),
      }),
    );
  });

  it("aborts when pagination does not advance", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        batchResponse({ nextCursor: "pst_same", done: false }),
      )
      .mockResolvedValueOnce(
        batchResponse({ nextCursor: "pst_same", done: false }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      run(["--url", "https://example.com", "--token", "secret"]),
    ).rejects.toThrow("without advancing the cursor");
  });
});
