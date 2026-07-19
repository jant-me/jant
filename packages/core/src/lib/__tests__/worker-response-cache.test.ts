import { describe, expect, it } from "vitest";
import type { Bindings } from "../../types.js";
import { POST_BODY_HTML_VERSION } from "../post-body-html.js";
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
