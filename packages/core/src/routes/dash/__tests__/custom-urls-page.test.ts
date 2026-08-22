/**
 * What the Custom URLs settings page shows for a legacy archive path.
 *
 * The row is the whole affordance: it prints the query the path holds, and its
 * menu deletes. It deliberately offers no "turn into a smart collection" —
 * that row *is* the registration of its own address, so the collection it would
 * become could never be saved at the URL the offer was about.
 */

import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { customUrlsRoutes } from "../custom-urls.js";

function createCustomUrlsTestApp() {
  const testApp = createTestApp({ authenticated: true });
  const { app } = testApp;

  app.use("*", async (c, next) => {
    c.set("publicPath", c.req.path);
    c.set("publicRequestUrl", c.req.url);
    await next();
  });

  app.route("/settings/custom-urls", customUrlsRoutes);

  return testApp;
}

describe("custom URLs settings page", () => {
  it("shows a legacy archive path and offers only deletion", async () => {
    const { app, services } = createCustomUrlsTestApp();

    // How a real legacy row exists: written before the create path was closed.
    await services.paths.create({
      path: "/notes-only",
      kind: "archive",
      archiveQuery: "format=note&title=none",
    });

    const res = await app.request("/settings/custom-urls");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("/notes-only");
    expect(html).toContain("/archive?format=note&amp;title=none");
    expect(html).toContain('data-custom-url-action="delete"');
    expect(html).not.toContain('data-custom-url-action="upgrade"');
  });
});
