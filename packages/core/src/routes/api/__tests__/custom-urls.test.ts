import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { customUrlsApiRoutes } from "../custom-urls.js";

function setup() {
  const testApp = createTestApp({ authenticated: true });
  testApp.app.route("/api/custom-urls", customUrlsApiRoutes);
  const post = (body: Record<string, unknown>) =>
    testApp.app.request("/api/custom-urls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { ...testApp, post };
}

describe("Custom URLs API", () => {
  it("takes a post by slug or by ID, and answers with the ID and a leading slash", async () => {
    const { services, post } = setup();
    const target = await services.posts.create({
      format: "note",
      title: "On writing",
      bodyMarkdown: "Words",
    });

    const bySlug = await post({
      path: "essays/on-writing",
      targetType: "post",
      targetId: target.slug,
    });
    expect(bySlug.status).toBe(201);
    expect(await bySlug.json()).toMatchObject({
      path: "/essays/on-writing",
      targetType: "post",
      targetId: target.id,
    });

    const byId = await post({
      path: "/writing",
      targetType: "post",
      targetId: target.id,
    });
    expect(byId.status).toBe(201);
    expect((await byId.json()).targetId).toBe(target.id);
  });

  it("answers 404 for a target that doesn't exist, by slug or by ID", async () => {
    const { post } = setup();

    for (const targetId of ["no-such-post", "pst_01jpyx3m7gw4w3h7m4bknq0v1d"]) {
      const res = await post({
        path: "/elsewhere",
        targetType: "post",
        targetId,
      });
      expect(res.status).toBe(404);
    }
  });

  it("pages newest first with nextCursor", async () => {
    const { app, post } = setup();
    for (const path of ["/one", "/two", "/three"]) {
      await post({ path, targetType: "redirect", toPath: "/" });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const res: Response = await app.request(
        `/api/custom-urls?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        customUrls: { path: string }[];
        nextCursor: string | null;
      };
      seen.push(...body.customUrls.map((item) => item.path));
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    expect(seen.sort()).toEqual(["/one", "/three", "/two"]);
    expect(cursor).toBeNull();
  });

  it("refuses a cursor it didn't hand out", async () => {
    const { app } = setup();

    const res = await app.request("/api/custom-urls?cursor=not-a-cursor");

    expect(res.status).toBe(400);
  });
});
