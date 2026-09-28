/**
 * `POST /api/upload` answers with the media object `GET /api/media/:id`
 * returns, as every create does. It used to answer its own shape, whose
 * `filename` was the stored name, not the one the file was uploaded under.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import type { StorageDriver } from "../../../lib/storage.js";
import { uploadApiRoutes } from "../upload.js";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

describe("POST /api/upload", () => {
  it("answers 201 with the media object", async () => {
    const storage = {
      put: vi.fn(async () => {}),
      get: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
    } as unknown as StorageDriver;
    const { app } = createTestApp({ authenticated: true, storage });
    app.route("/api/upload", uploadApiRoutes);

    const form = new FormData();
    form.append(
      "file",
      new File([PNG], "Holiday photo.png", { type: "image/png" }),
    );
    const res = await app.request("/api/upload", {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: expect.stringMatching(/^med_/),
      type: "media",
      mediaKind: "image",
      mimeType: "image/png",
      originalName: "Holiday photo.png",
      url: expect.any(String),
    });
    expect(body).not.toHaveProperty("filename");
  });
});
