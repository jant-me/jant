import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendDiscoverPing } from "../discover-ping.js";

const NOW = 1_800_000_000;

/** No real waiting between attempts; the retry itself is what is under test. */
const options = {
  endpoint: "https://directory.example/api/discover/ping",
  feedUrl: "https://example.com/latest/feed",
  now: () => NOW,
  sleep: async () => {},
};

describe("sendDiscoverPing", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the feed address and nothing else", async () => {
    const outcome = await sendDiscoverPing(options);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      globalThis.RequestInit,
    ];
    expect(url).toBe("https://directory.example/api/discover/ping");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      feed: "https://example.com/latest/feed",
    });
    expect(outcome).toMatchObject({
      at: NOW,
      ok: true,
      feedUrl: "https://example.com/latest/feed",
    });
  });

  it("does not retry an announcement that got through", async () => {
    await sendDiscoverPing(options);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The failure worth retrying automatically: a directory mid-deploy, or one
  // answering a transient 5xx. One more attempt costs nothing and fixes it.
  it("retries once, and reports success when the second attempt lands", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    const outcome = await sendDiscoverPing(options);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.ok).toBe(true);
    expect(outcome.error).toBeUndefined();
  });

  // The whole point of the rewrite: a lost announcement leaves evidence the
  // owner can read, instead of a line in a log nobody sees.
  it("reports the status a refusing directory answered", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));

    const outcome = await sendDiscoverPing(options);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ at: NOW, ok: false, status: 403 });
    expect(outcome.error).toContain("403");
  });

  it("reports a network failure rather than throwing", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const outcome = await sendDiscoverPing(options);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("ECONNREFUSED");
    // No `status`: nothing answered, so claiming one would be a fabrication.
    expect(outcome.status).toBeUndefined();
  });
});
