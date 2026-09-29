/**
 * A custom URL that redirects sends the reader where the author said.
 *
 * The target went through the path normalizer, which lowercased it, dropped
 * its query string's case, and folded `//`, and the redirect then put a `/`
 * in front: `https://Example.com/Page` came out as `/https:/example.com/page`,
 * and `/archive?format=Note` lost its `Note`.
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { Database } from "../db/index.js";
import { createServices } from "../services/index.js";
import type { Bindings } from "../types.js";
import { createTestDatabase, DEFAULT_TEST_SITE_ID } from "./helpers/db.js";

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as Parameters<ReturnType<typeof createApp>["fetch"]>[2];

async function createSite() {
  const { db, sqlite } = createTestDatabase();
  const services = createServices(
    db as unknown as Database,
    { query: async () => [] } as unknown as Parameters<
      typeof createServices
    >[1],
    DEFAULT_TEST_SITE_ID,
    { slugIdLength: 5 },
  );
  await services.settings.completeOnboarding();
  const app = createApp();
  const get = (path: string) =>
    app.fetch(
      new Request(`https://blog.example${path}`, { redirect: "manual" }),
      {
        SITE_ORIGIN: "https://blog.example",
        AUTH_SECRET: "x".repeat(40),
        NODE_SQLITE: sqlite,
      } as unknown as Bindings,
      executionCtx,
    );
  return { services, get };
}

describe("custom URL redirects", () => {
  it("sends a reader to an address on another site as given", async () => {
    const { services, get } = await createSite();
    const created = await services.customUrls.create({
      path: "/elsewhere",
      targetType: "redirect",
      toPath: "https://Example.com/Some/Page?ref=Jant",
    });

    const res = await get("/elsewhere");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(
      "https://example.com/Some/Page?ref=Jant",
    );
    expect(created.toPath).toBe("https://example.com/Some/Page?ref=Jant");
  });

  it("keeps the query string of a target on the site", async () => {
    const { services, get } = await createSite();
    await services.customUrls.create({
      path: "/notes-only",
      targetType: "redirect",
      toPath: "/Archive/?format=Note",
      redirectType: 302,
    });

    const res = await get("/notes-only");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/archive?format=Note");
  });

  // A link someone shared with `?page=2` still lands on page 2. A target
  // with a query string of its own, or one off the site, keeps what the
  // author set.
  it("carries the reader's query string to a target on the site without one", async () => {
    const { services, get } = await createSite();
    await services.customUrls.create({
      path: "/old-archive",
      targetType: "redirect",
      toPath: "/archive",
    });
    await services.customUrls.create({
      path: "/notes-only",
      targetType: "redirect",
      toPath: "/archive?format=note",
    });
    await services.customUrls.create({
      path: "/elsewhere",
      targetType: "redirect",
      toPath: "https://example.com/page",
    });

    const location = async (path: string) =>
      (await get(path)).headers.get("location");
    expect(await location("/old-archive?page=2")).toBe("/archive?page=2");
    expect(await location("/notes-only?page=2")).toBe("/archive?format=note");
    expect(await location("/elsewhere?page=2")).toBe(
      "https://example.com/page",
    );
  });
});
