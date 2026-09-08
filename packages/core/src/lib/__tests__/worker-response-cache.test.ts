import { describe, expect, it } from "vitest";
import type { Bindings } from "../../types.js";
import { POST_BODY_HTML_VERSION } from "../post-body-html.js";
import { withConditionalResponse } from "../http-cache.js";
import {
  normalizeWorkerCacheKeyUrl,
  withWorkerResponseCache,
} from "../worker-response-cache.js";

interface StoredResponse {
  body: Uint8Array;
  headers: [string, string][];
  status: number;
  statusText: string;
}

type CacheKey = Request | string | URL;

function createMemoryCache() {
  const store = new Map<string, StoredResponse>();

  function toKey(input: CacheKey): string {
    if (input instanceof Request) {
      return input.url;
    }

    if (input instanceof URL) {
      return input.toString();
    }

    return String(input);
  }

  return {
    async match(input: CacheKey) {
      const stored = store.get(toKey(input));
      if (!stored) {
        return undefined;
      }

      return new Response(stored.body.slice(), {
        headers: stored.headers,
        status: stored.status,
        statusText: stored.statusText,
      });
    },
    async put(input: CacheKey, response: Response) {
      const body = new Uint8Array(await response.arrayBuffer());
      store.set(toKey(input), {
        body,
        headers: [...response.headers.entries()],
        status: response.status,
        statusText: response.statusText,
      });
    },
  };
}

function createCloudflareBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DB: {} as D1Database,
    ...overrides,
  };
}

describe("withWorkerResponseCache", () => {
  it("versions cache keys with the current body HTML contract", () => {
    const url = new URL(
      normalizeWorkerCacheKeyUrl(
        "https://example.com/feed?__jant_body_html=old&utm_source=test",
      ),
    );

    expect(url.searchParams.get("__jant_body_html")).toBe(
      String(POST_BODY_HTML_VERSION),
    );
    expect(url.searchParams.has("utm_source")).toBe(false);
  });

  it("caches anonymous phase-one feed responses and normalizes tracking params", async () => {
    const cache = createMemoryCache();
    const bindings = createCloudflareBindings();
    let nextCallCount = 0;

    const first = await withWorkerResponseCache({
      bindings,
      cache,
      request: new Request(
        "https://example.com/feed/latest?format=note&utm_source=newsletter",
      ),
      next: async () => {
        nextCallCount += 1;
        return new Response("fresh", {
          headers: {
            "Cache-Control": "public, max-age=180",
            "Content-Type": "application/atom+xml; charset=utf-8",
          },
        });
      },
    });

    expect(await first.text()).toBe("fresh");
    expect(nextCallCount).toBe(1);

    const second = await withWorkerResponseCache({
      bindings,
      cache,
      request: new Request(
        "https://example.com/feed/latest?utm_source=twitter&format=note",
      ),
      next: async () => {
        nextCallCount += 1;
        return new Response("new", {
          headers: {
            "Cache-Control": "public, max-age=180",
            "Content-Type": "application/atom+xml; charset=utf-8",
          },
        });
      },
    });

    expect(await second.text()).toBe("fresh");
    expect(nextCallCount).toBe(1);
  });

  it("bypasses cache for requests with better-auth cookies", async () => {
    const cache = createMemoryCache();
    const bindings = createCloudflareBindings();
    let nextCallCount = 0;

    await withWorkerResponseCache({
      bindings,
      cache,
      request: new Request("https://example.com/feed"),
      next: async () => {
        nextCallCount += 1;
        return new Response("cached", {
          headers: { "Cache-Control": "public, max-age=180" },
        });
      },
    });

    const authResponse = await withWorkerResponseCache({
      bindings,
      cache,
      request: new Request("https://example.com/feed", {
        headers: { Cookie: "better-auth.session_token=abc" },
      }),
      next: async () => {
        nextCallCount += 1;
        return new Response("fresh", {
          headers: { "Cache-Control": "public, max-age=180" },
        });
      },
    });

    expect(await authResponse.text()).toBe("fresh");
    expect(nextCallCount).toBe(2);

    const anonymousResponse = await withWorkerResponseCache({
      bindings,
      cache,
      request: new Request("https://example.com/feed"),
      next: async () => {
        nextCallCount += 1;
        return new Response("should-not-run", {
          headers: { "Cache-Control": "public, max-age=180" },
        });
      },
    });

    expect(await anonymousResponse.text()).toBe("cached");
    expect(nextCallCount).toBe(2);
  });

  it("treats prefixed single-site feed URLs as cacheable", async () => {
    const cache = createMemoryCache();
    const bindings = createCloudflareBindings({ SITE_PATH_PREFIX: "/blog" });
    let nextCallCount = 0;

    const first = await withWorkerResponseCache({
      bindings,
      cache,
      request: new Request("https://example.com/blog/reading/feed"),
      next: async () => {
        nextCallCount += 1;
        return new Response("prefixed", {
          headers: {
            "Cache-Control": "public, max-age=180",
            "Content-Type": "application/atom+xml; charset=utf-8",
          },
        });
      },
    });

    expect(await first.text()).toBe("prefixed");

    const second = await withWorkerResponseCache({
      bindings,
      cache,
      request: new Request(
        "https://example.com/blog/reading/feed?utm_campaign=spring",
      ),
      next: async () => {
        nextCallCount += 1;
        return new Response("new", {
          headers: {
            "Cache-Control": "public, max-age=180",
            "Content-Type": "application/atom+xml; charset=utf-8",
          },
        });
      },
    });

    expect(await second.text()).toBe("prefixed");
    expect(nextCallCount).toBe(1);
  });

  it("caches public icon assets with versioned URLs", async () => {
    const cache = createMemoryCache();
    const bindings = createCloudflareBindings();
    let nextCallCount = 0;

    const first = await withWorkerResponseCache({
      bindings,
      cache,
      request: new Request(
        "https://example.com/apple-touch-icon.png?v=20260406&utm_source=home",
      ),
      next: async () => {
        nextCallCount += 1;
        return new Response("icon", {
          headers: {
            "Cache-Control": "public, max-age=86400",
            "Content-Type": "image/png",
          },
        });
      },
    });

    expect(await first.text()).toBe("icon");

    const second = await withWorkerResponseCache({
      bindings,
      cache,
      request: new Request(
        "https://example.com/apple-touch-icon.png?v=20260406",
      ),
      next: async () => {
        nextCallCount += 1;
        return new Response("new-icon", {
          headers: {
            "Cache-Control": "public, max-age=86400",
            "Content-Type": "image/png",
          },
        });
      },
    });

    expect(await second.text()).toBe("icon");
    expect(nextCallCount).toBe(1);
  });

  it("does not store non-success responses even on cacheable routes", async () => {
    const cache = createMemoryCache();
    const bindings = createCloudflareBindings();
    let nextCallCount = 0;

    const first = await withWorkerResponseCache({
      bindings,
      cache,
      request: new Request("https://example.com/feed/all"),
      next: async () => {
        nextCallCount += 1;
        return new Response(null, {
          status: 308,
          headers: { Location: "/feed/latest" },
        });
      },
    });

    expect(first.status).toBe(308);

    const second = await withWorkerResponseCache({
      bindings,
      cache,
      request: new Request("https://example.com/feed/all"),
      next: async () => {
        nextCallCount += 1;
        return new Response(null, {
          status: 308,
          headers: { Location: "/feed/latest" },
        });
      },
    });

    expect(second.status).toBe(308);
    expect(nextCallCount).toBe(2);
  });

  it("stays disabled outside the Cloudflare worker runtime", async () => {
    const cache = createMemoryCache();
    let nextCallCount = 0;

    await cache.put(
      new Request("https://example.com/favicon.ico?v=20260406"),
      new Response("cached", {
        headers: { "Cache-Control": "public, max-age=86400" },
      }),
    );

    const response = await withWorkerResponseCache({
      bindings: {
        NODE_DATABASE: {} as Bindings["NODE_DATABASE"],
      },
      cache,
      request: new Request("https://example.com/favicon.ico?v=20260406"),
      next: async () => {
        nextCallCount += 1;
        return new Response("fresh", {
          headers: { "Cache-Control": "public, max-age=86400" },
        });
      },
    });

    expect(await response.text()).toBe("fresh");
    expect(nextCallCount).toBe(1);
  });
});

/**
 * Revalidation composed with the cache, the way `createApp()` composes them:
 * conditional handling on the outside, so it sees a cache hit and a cache miss
 * alike.
 */
describe("withWorkerResponseCache under conditional requests", () => {
  const FEED_URL = "https://example.com/feed";
  const ETAG = '"feed-v1"';

  function feedResponse() {
    return new Response("<feed/>", {
      headers: {
        "Cache-Control": "public, max-age=60",
        "Content-Type": "application/atom+xml; charset=utf-8",
        ETag: ETAG,
      },
    });
  }

  async function poll(
    cache: ReturnType<typeof createMemoryCache>,
    ifNoneMatch: string | undefined,
    next: () => Promise<Response>,
  ) {
    const request = new Request(
      FEED_URL,
      ifNoneMatch ? { headers: { "If-None-Match": ifNoneMatch } } : undefined,
    );

    return withConditionalResponse(
      request,
      await withWorkerResponseCache({
        bindings: createCloudflareBindings(),
        cache,
        request,
        next,
      }),
    );
  }

  it("stores the full document even when the poll that filled the cache got a 304", async () => {
    const cache = createMemoryCache();
    let renders = 0;
    const render = async () => {
      renders += 1;
      return feedResponse();
    };

    // A reader that already holds this version, arriving on a cache miss.
    const conditional = await poll(cache, ETAG, render);
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
    expect(renders).toBe(1);

    // The next reader gets the document from the cache, not another render.
    const unconditional = await poll(cache, undefined, render);
    expect(unconditional.status).toBe(200);
    expect(await unconditional.text()).toBe("<feed/>");
    expect(renders).toBe(1);
  });

  it("revalidates a cache hit without reaching a route", async () => {
    const cache = createMemoryCache();
    let renders = 0;
    const render = async () => {
      renders += 1;
      return feedResponse();
    };

    await poll(cache, undefined, render);
    const revalidated = await poll(cache, ETAG, render);

    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("ETag")).toBe(ETAG);
    expect(revalidated.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(renders).toBe(1);
  });

  it("serves the document again once the cached version no longer matches", async () => {
    const cache = createMemoryCache();

    await poll(cache, undefined, async () => feedResponse());
    const stale = await poll(cache, '"feed-v0"', async () => feedResponse());

    expect(stale.status).toBe(200);
    expect(await stale.text()).toBe("<feed/>");
  });
});
