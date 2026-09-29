/**
 * `/foo/` redirects to `/foo`. The rewrite must never produce an address a
 * browser reads as another host: `//evil.com/` trimmed naively is the
 * protocol-relative `//evil.com`, and a 301 is cached for good.
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { Bindings } from "../types.js";
import { createTestDatabase } from "./helpers/db.js";

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as Parameters<ReturnType<typeof createApp>["fetch"]>[2];

function get(path: string, init?: ConstructorParameters<typeof Request>[1]) {
  const { sqlite } = createTestDatabase();
  return createApp().fetch(
    new Request(`https://blog.example${path}`, init),
    {
      SITE_ORIGIN: "https://blog.example",
      AUTH_SECRET: "x".repeat(40),
      NODE_SQLITE: sqlite,
    } as unknown as Bindings,
    executionCtx,
  );
}

describe("trailing slash redirect", () => {
  it("drops the trailing slash and keeps the query", async () => {
    const res = await get("/archive/?year=2024");

    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/archive?year=2024");
  });

  it.each(["//evil.com/", "/\\evil.com/", "///evil.com/"])(
    "keeps %s on this site",
    async (path) => {
      const res = await get(path);

      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/evil.com");
    },
  );

  // A 301 turns a POST into a GET in fetch, curl -L, and requests: the
  // client gets a 200 list and nothing is created.
  it("keeps the method of a write with 308", async () => {
    const res = await get("/api/posts/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/api/posts");
  });
});
