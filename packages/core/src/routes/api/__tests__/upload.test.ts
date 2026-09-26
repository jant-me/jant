import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { createEntityId } from "../../../lib/ids.js";
import { uploadApiRoutes } from "../upload.js";

function createMockStorage() {
  return {
    delete: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    head: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Upload API Routes", () => {
  it("lists media and supports mimePrefix filtering", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/upload", uploadApiRoutes);

    await services.media.create({
      filename: "photo.webp",
      originalName: "photo.webp",
      mimeType: "image/webp",
      size: 1024,
      storageKey: "media/photo.webp",
      width: 1200,
      height: 800,
    });
    await services.media.create({
      filename: "notes.txt",
      originalName: "notes.txt",
      mimeType: "text/plain",
      size: 24,
      storageKey: "media/notes.txt",
    });

    const res = await app.request("/api/upload?mimePrefix=image/");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.media).toHaveLength(1);
    expect(body.media[0]).toMatchObject({
      filename: "photo.webp",
      mimeType: "image/webp",
      type: "media",
    });
  });

  it("pages the media list with nextCursor", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/upload", uploadApiRoutes);

    for (const name of ["a", "b", "c"]) {
      await services.media.create({
        filename: `${name}.webp`,
        originalName: `${name}.webp`,
        mimeType: "image/webp",
        size: 1024,
        storageKey: `media/${name}.webp`,
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page += 1) {
      const res = await app.request(
        `/api/upload?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        media: { filename: string }[];
        nextCursor: string | null;
      };
      seen.push(...body.media.map((media) => media.filename));
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    expect(seen.sort()).toEqual(["a.webp", "b.webp", "c.webp"]);
    expect(cursor).toBeNull();
  });

  it("returns a single media item", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/upload", uploadApiRoutes);

    const media = await services.media.create({
      filename: "photo.webp",
      originalName: "photo.webp",
      mimeType: "image/webp",
      size: 1024,
      storageKey: "media/photo.webp",
      width: 1200,
      height: 800,
    });

    const res = await app.request(`/api/upload/${media.id}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      id: media.id,
      filename: "photo.webp",
      mimeType: "image/webp",
      type: "media",
    });
  });

  it("updates alt text", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/upload", uploadApiRoutes);

    const media = await services.media.create({
      filename: "photo.webp",
      originalName: "photo.webp",
      mimeType: "image/webp",
      size: 1024,
      storageKey: "media/photo.webp",
    });

    const res = await app.request(`/api/upload/${media.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt: "  Cover image  " }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.alt).toBe("Cover image");
    expect((await services.media.getById(media.id))?.alt).toBe("Cover image");
  });

  it("deletes a media item", async () => {
    const storage = createMockStorage();
    const { app, services } = createTestApp({
      authenticated: true,
      storage,
    });
    app.route("/api/upload", uploadApiRoutes);

    const media = await services.media.create({
      filename: "photo.webp",
      originalName: "photo.webp",
      mimeType: "image/webp",
      size: 1024,
      storageKey: "media/photo.webp",
    });

    const res = await app.request(`/api/upload/${media.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(await services.media.getById(media.id)).toBeNull();
    // This mock exposes no server-side copy, so the object is retired by
    // deleting the original key immediately (no recycle window).
    expect(storage.delete).toHaveBeenCalledWith("media/photo.webp");
  });

  it("returns 404 for a missing media item", async () => {
    const { app } = createTestApp({ authenticated: true });
    app.route("/api/upload", uploadApiRoutes);
    const missingId = createEntityId("media");

    const res = await app.request(`/api/upload/${missingId}`);
    expect(res.status).toBe(404);
  });
});
