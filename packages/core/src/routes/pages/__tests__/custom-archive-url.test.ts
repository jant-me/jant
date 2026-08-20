/**
 * Coverage for archive queries stored in the path registry.
 *
 * A custom URL of kind `archive` hands `renderArchivePage` a query the author
 * wrote, not one the reader assembled. That distinction decides what a
 * signed-out reader gets when the query names a set only the author can see:
 * the /archive route rewrites such a URL, but here the path *is* the name, so
 * there is nothing to rewrite. Rendering the query with the clause quietly
 * dropped would serve a different set under a name the author chose for
 * another one.
 */

import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { pageRoutes } from "../page.js";

function createPageTestApp(authenticated = false) {
  const testApp = createTestApp({ authenticated });
  const { app } = testApp;

  app.use("*", async (c, next) => {
    c.set("publicPath", c.req.path);
    c.set("publicRequestUrl", c.req.url);
    await next();
  });

  app.route("/", pageRoutes);

  return testApp;
}

async function seed(services: {
  posts: { create: (input: Record<string, unknown>) => Promise<unknown> };
  customUrls: {
    create: (input: Record<string, unknown>) => Promise<unknown>;
  };
}) {
  await services.posts.create({
    format: "note",
    bodyMarkdown: "body on the stream",
    status: "published",
  });
  await services.posts.create({
    format: "note",
    bodyMarkdown: "body kept back",
    status: "published",
    visibility: "private",
  });
  await services.customUrls.create({
    path: "/private-notes",
    targetType: "archive",
    archiveQuery: "visibility=private",
  });
  await services.customUrls.create({
    path: "/every-note",
    targetType: "archive",
    archiveQuery: "format=note",
  });
}

describe("custom archive URLs", () => {
  it("renders a stored query the reader is allowed to see", async () => {
    const { app, services } = createPageTestApp();
    await seed(services);

    const res = await app.request("/every-note");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("body on the stream");
    expect(html).not.toContain("body kept back");
  });

  it("404s a stored query naming a set only the author can see", async () => {
    const { app, services } = createPageTestApp();
    await seed(services);

    const res = await app.request("/private-notes");
    expect(res.status).toBe(404);
  });

  // The bug this covers: the clause used to evaporate for signed-out readers,
  // so /private-notes served the whole public archive under that name.
  it("never widens a stored private query into the public archive", async () => {
    const { app, services } = createPageTestApp();
    await seed(services);

    const res = await app.request("/private-notes");
    expect(await res.text()).not.toContain("body on the stream");
  });

  it("renders the same stored query for the author", async () => {
    const { app, services } = createPageTestApp(true);
    await seed(services);

    const res = await app.request("/private-notes");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("body kept back");
    expect(html).not.toContain("body on the stream");
  });

  // Same rule, reached through a stored query: a collection that was deleted
  // after the path was saved leaves the path naming nothing, and the honest
  // answer is that it no longer resolves — not the whole archive.
  it("404s a stored query naming a collection that is gone", async () => {
    const { app, services } = createPageTestApp();
    await seed(services);
    await services.customUrls.create({
      path: "/gone",
      targetType: "archive",
      archiveQuery: "collection=deleted-collection",
    });

    const res = await app.request("/gone");
    expect(res.status).toBe(404);
  });
});
