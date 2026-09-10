import { describe, expect, it } from "vitest";
import {
  matchesIfNoneMatch,
  strongETag,
  withConditionalResponse,
} from "../http-cache.js";

describe("strongETag", () => {
  it("returns a quoted 32-character hex tag", async () => {
    const etag = await strongETag("<feed/>");

    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it("is stable for identical bodies and differs for changed ones", async () => {
    const [first, second, other] = await Promise.all([
      strongETag("<feed><entry>a</entry></feed>"),
      strongETag("<feed><entry>a</entry></feed>"),
      strongETag("<feed><entry>b</entry></feed>"),
    ]);

    expect(first).toBe(second);
    expect(other).not.toBe(first);
  });

  it("hashes UTF-8 bytes, so non-ASCII content is distinguished", async () => {
    const [chinese, ascii] = await Promise.all([
      strongETag("笔记"),
      strongETag("note"),
    ]);

    expect(chinese).not.toBe(ascii);
  });
});

describe("matchesIfNoneMatch", () => {
  it("treats a missing header as no match", () => {
    expect(matchesIfNoneMatch(undefined, '"abc"')).toBe(false);
    expect(matchesIfNoneMatch(null, '"abc"')).toBe(false);
    expect(matchesIfNoneMatch("", '"abc"')).toBe(false);
  });

  it("matches the same tag", () => {
    expect(matchesIfNoneMatch('"abc"', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"abc"', '"def"')).toBe(false);
  });

  it("matches any tag in a list", () => {
    expect(matchesIfNoneMatch('"abc", "def" , "ghi"', '"def"')).toBe(true);
    expect(matchesIfNoneMatch('"abc", "def"', '"ghi"')).toBe(false);
  });

  it("ignores the weak prefix on either side", () => {
    expect(matchesIfNoneMatch('W/"abc"', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"abc"', 'W/"abc"')).toBe(true);
  });

  it("matches the wildcard", () => {
    expect(matchesIfNoneMatch("*", '"abc"')).toBe(true);
    expect(matchesIfNoneMatch(" * ", '"abc"')).toBe(true);
  });

  it("does not tear a tag containing a comma", () => {
    expect(matchesIfNoneMatch('"a,b"', '"a,b"')).toBe(true);
    expect(matchesIfNoneMatch('"a,b"', '"a"')).toBe(false);
  });

  it("ignores an unquoted tag rather than matching it loosely", () => {
    expect(matchesIfNoneMatch("abc", '"abc"')).toBe(false);
  });
});

describe("withConditionalResponse", () => {
  function ok(headers: Record<string, string> = {}) {
    return new Response("body", {
      headers: {
        ETag: '"abc"',
        "Cache-Control": "public, max-age=60",
        ...headers,
      },
    });
  }

  function get(headers: Record<string, string> = {}) {
    return new Request("https://example.com/feed", { headers });
  }

  it("returns a bare 304 when the client holds the current version", async () => {
    const res = withConditionalResponse(
      get({ "If-None-Match": '"abc"' }),
      ok(),
    );

    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("carries the headers a cache stores the entry under", () => {
    const res = withConditionalResponse(
      get({ "If-None-Match": '"abc"' }),
      ok({ Vary: "Accept-Language", "Content-Type": "application/atom+xml" }),
    );

    expect(res.headers.get("ETag")).toBe('"abc"');
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(res.headers.get("Vary")).toBe("Accept-Language");
    expect(res.headers.get("Content-Type")).toBeNull();
  });

  it("passes the response through when the tag does not match", async () => {
    const res = withConditionalResponse(
      get({ "If-None-Match": '"stale"' }),
      ok(),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("body");
  });

  it("passes through a request that asks nothing", () => {
    expect(withConditionalResponse(get(), ok()).status).toBe(200);
  });

  it("leaves a response without a validator alone", () => {
    const res = withConditionalResponse(
      get({ "If-None-Match": "*" }),
      new Response("body"),
    );

    expect(res.status).toBe(200);
  });

  it("only revalidates GET and HEAD", () => {
    const post = new Request("https://example.com/feed", {
      method: "POST",
      headers: { "If-None-Match": '"abc"' },
    });

    expect(withConditionalResponse(post, ok()).status).toBe(200);
  });

  it("only revalidates a 200", () => {
    const created = new Response("body", {
      status: 201,
      headers: { ETag: '"abc"' },
    });

    expect(
      withConditionalResponse(get({ "If-None-Match": '"abc"' }), created)
        .status,
    ).toBe(201);
  });

  it("leaves a response that sets a cookie alone", () => {
    const res = withConditionalResponse(
      get({ "If-None-Match": '"abc"' }),
      ok({ "Set-Cookie": "session=1" }),
    );

    expect(res.status).toBe(200);
  });
});
