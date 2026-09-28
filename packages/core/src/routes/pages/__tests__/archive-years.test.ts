/**
 * The archive's year picker is part of the page, so it offers only the years
 * the reader has posts in.
 */

import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { archiveRoutes } from "../archive.js";

const YEAR_2019 = Math.floor(Date.UTC(2019, 5, 1) / 1000);
const YEAR_2024 = Math.floor(Date.UTC(2024, 5, 1) / 1000);

async function archiveHtml(authenticated: boolean) {
  const { app, services } = createTestApp({ authenticated });
  app.route("/archive", archiveRoutes);
  await services.posts.create({
    format: "note",
    bodyMarkdown: "public",
    status: "published",
    publishedAt: YEAR_2024,
  });
  await services.posts.create({
    format: "note",
    bodyMarkdown: "private",
    status: "published",
    visibility: "private",
    publishedAt: YEAR_2019,
  });
  return (await app.request("/archive")).text();
}

describe("archive year picker", () => {
  it("leaves out a year that has only private posts for a signed-out reader", async () => {
    const html = await archiveHtml(false);

    expect(html).toContain("year=2024");
    expect(html).not.toContain("year=2019");
  });

  it("offers it to the signed-in author", async () => {
    const html = await archiveHtml(true);

    expect(html).toContain("year=2019");
  });
});
