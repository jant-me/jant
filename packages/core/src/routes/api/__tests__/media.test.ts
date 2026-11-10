import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { createEntityId } from "../../../lib/ids.js";
import { mediaApiRoutes } from "../media.js";

function createMockStorage() {
  return {
    delete: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    head: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Media API Routes", () => {
  it("lists media and supports mimePrefix filtering", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/media", mediaApiRoutes);

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

    const res = await app.request("/api/media?mimePrefix=image/");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.media).toHaveLength(1);
    expect(body.media[0]).toMatchObject({
      originalName: "photo.webp",
      mimeType: "image/webp",
      type: "media",
    });
  });

  it("pages the media list with nextCursor", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/media", mediaApiRoutes);

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
        `/api/media?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        media: { originalName: string }[];
        nextCursor: string | null;
      };
      seen.push(...body.media.map((media) => media.originalName));
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    expect(seen.sort()).toEqual(["a.webp", "b.webp", "c.webp"]);
    expect(cursor).toBeNull();
  });

  it("returns a single media item", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/media", mediaApiRoutes);

    const media = await services.media.create({
      filename: "photo.webp",
      originalName: "photo.webp",
      mimeType: "image/webp",
      size: 1024,
      storageKey: "media/photo.webp",
      width: 1200,
      height: 800,
    });

    const res = await app.request(`/api/media/${media.id}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      id: media.id,
      originalName: "photo.webp",
      mimeType: "image/webp",
      type: "media",
    });
  });

  it("updates alt text", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/media", mediaApiRoutes);

    const media = await services.media.create({
      filename: "photo.webp",
      originalName: "photo.webp",
      mimeType: "image/webp",
      size: 1024,
      storageKey: "media/photo.webp",
    });

    const res = await app.request(`/api/media/${media.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt: "  Cover image  " }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.alt).toBe("Cover image");
    expect((await services.media.getById(media.id))?.alt).toBe("Cover image");

    const cleared = await app.request(`/api/media/${media.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt: "   " }),
    });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).alt).toBeNull();
  });

  it("deletes a media item", async () => {
    const storage = createMockStorage();
    const { app, services } = createTestApp({
      authenticated: true,
      storage,
    });
    app.route("/api/media", mediaApiRoutes);

    const media = await services.media.create({
      filename: "photo.webp",
      originalName: "photo.webp",
      mimeType: "image/webp",
      size: 1024,
      storageKey: "media/photo.webp",
    });

    const res = await app.request(`/api/media/${media.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(await services.media.getById(media.id)).toBeNull();
    // This mock exposes no server-side copy, so the object is retired by
    // deleting the original key immediately (no recycle window).
    expect(storage.delete).toHaveBeenCalledWith("media/photo.webp");
  });

  describe("PUT /api/media/:id/poster", () => {
    const WEBP = new Uint8Array([
      ...new TextEncoder().encode("RIFF"),
      0,
      0,
      0,
      0,
      ...new TextEncoder().encode("WEBP"),
      0,
    ]);
    const PNG = new Uint8Array([
      0x89,
      ...new TextEncoder().encode("PNG"),
      0x0d,
      0x0a,
      0x1a,
      0x0a,
    ]);

    function setUp() {
      const storage = createMockStorage();
      const { app, services } = createTestApp({
        authenticated: true,
        storage,
      });
      app.route("/api/media", mediaApiRoutes);
      return { app, services, storage };
    }

    function createVideo(
      services: ReturnType<typeof createTestApp>["services"],
      posterKey?: string,
    ) {
      return services.media.create({
        filename: "clip.mp4",
        originalName: "clip.mp4",
        mimeType: "video/mp4",
        size: 4096,
        storageKey: "media/clip.mp4",
        posterKey,
      });
    }

    it("gives a video uploaded without one its poster", async () => {
      const { app, services, storage } = setUp();
      const video = await createVideo(services);

      const res = await app.request(`/api/media/${video.id}/poster`, {
        method: "PUT",
        headers: { "Content-Type": "image/webp" },
        body: WEBP,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.posterUrl).toMatch(/\/posters\/med_[^/]+\.webp$/);
      const stored = await services.media.getById(video.id);
      expect(stored?.posterKey).toMatch(
        new RegExp(`/posters/${video.id}\\.webp$`),
      );
      expect(storage.put).toHaveBeenCalledWith(
        stored?.posterKey,
        expect.any(Uint8Array),
        { contentType: "image/webp" },
      );
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("stores a replacement under a new key and deletes the old poster", async () => {
      // Posters are served immutable: one rewritten in place would stay
      // stale in every cache that already holds it.
      const { app, services, storage } = setUp();
      const video = await createVideo(services, "media/posters/old.webp");

      const res = await app.request(`/api/media/${video.id}/poster`, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: PNG,
      });

      expect(res.status).toBe(200);
      const stored = await services.media.getById(video.id);
      expect(stored?.posterKey).toMatch(
        new RegExp(`/posters/${video.id}-[A-Za-z0-9]+\\.png$`),
      );
      expect(storage.put).toHaveBeenCalledWith(
        stored?.posterKey,
        expect.any(Uint8Array),
        { contentType: "image/png" },
      );
      expect(storage.delete).toHaveBeenCalledWith("media/posters/old.webp");
    });

    it("refuses a poster that is neither WebP nor PNG", async () => {
      const { app, services, storage } = setUp();
      const video = await createVideo(services);

      const res = await app.request(`/api/media/${video.id}/poster`, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]),
      });

      expect(res.status).toBe(400);
      expect(storage.put).not.toHaveBeenCalled();
      expect((await services.media.getById(video.id))?.posterKey).toBeNull();
    });

    it("refuses a poster for media that is not a video", async () => {
      const { app, services, storage } = setUp();
      const image = await services.media.create({
        filename: "photo.webp",
        originalName: "photo.webp",
        mimeType: "image/webp",
        size: 1024,
        storageKey: "media/photo.webp",
      });

      const res = await app.request(`/api/media/${image.id}/poster`, {
        method: "PUT",
        headers: { "Content-Type": "image/webp" },
        body: WEBP,
      });

      expect(res.status).toBe(400);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it("answers 404 for media that does not exist", async () => {
      const { app } = setUp();

      const res = await app.request(
        `/api/media/${createEntityId("media")}/poster`,
        {
          method: "PUT",
          headers: { "Content-Type": "image/webp" },
          body: WEBP,
        },
      );

      expect(res.status).toBe(404);
    });
  });

  it("returns 404 for a missing media item", async () => {
    const { app } = createTestApp({ authenticated: true });
    app.route("/api/media", mediaApiRoutes);
    const missingId = createEntityId("media");

    const res = await app.request(`/api/media/${missingId}`);
    expect(res.status).toBe(404);
  });
});
