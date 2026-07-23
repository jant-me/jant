import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { paletteApiRoutes } from "../palette.js";

describe("Command palette API", () => {
  it("includes post status so clients can route drafts to preview", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/palette", paletteApiRoutes);

    const draft = await services.posts.create({
      format: "note",
      title: "Draft destination",
      bodyMarkdown: "Not published yet.",
      status: "draft",
    });
    const published = await services.posts.create({
      format: "note",
      title: "Published destination",
      bodyMarkdown: "Already published.",
      status: "published",
    });

    const response = await app.request("/api/palette");
    const body = (await response.json()) as {
      items: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(body.items).toContainEqual({
      title: "Draft destination",
      path: draft.slug,
      type: "post",
      format: "note",
      status: "draft",
    });
    expect(body.items).toContainEqual({
      title: "Published destination",
      path: published.slug,
      type: "post",
      format: "note",
      status: "published",
    });
  });
});
