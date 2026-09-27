/**
 * Every API error answers `{ error, code }`, the shape docs/API.md's Error
 * Format section documents, so a client can branch on `code` alone.
 *
 * Several paths answered otherwise: a body that wasn't JSON surfaced as a
 * 500, an unknown `/api` path and the public-API switch answered plain text,
 * and the upload endpoints built `{ error }` by hand without a `code`.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import {
  errorHandler,
  notFoundHandler,
} from "../../../middleware/error-handler.js";
import { postsApiRoutes } from "../posts.js";
import { publicThreadsApiRoutes } from "../public/threads.js";
import { uploadApiRoutes } from "../upload.js";

async function errorOf(res: Response) {
  expect(res.headers.get("content-type")).toContain("application/json");
  return (await res.json()) as { error: string; code: string };
}

describe("API error shape", () => {
  it("answers a body that isn't JSON with 400 VALIDATION_ERROR", async () => {
    const { app } = createTestApp({ authenticated: true });
    app.route("/api/posts", postsApiRoutes);

    const res = await app.request("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });

    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("VALIDATION_ERROR");
  });

  it("answers an unknown /api path with JSON 404 NOT_FOUND", async () => {
    const { app } = createTestApp({ authenticated: true });

    const res = await app.request("/api/no-such-endpoint");

    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("NOT_FOUND");
  });

  it("answers the switched-off public API with JSON 404 NOT_FOUND", async () => {
    const { app, services } = createTestApp({ authenticated: false });
    app.route("/api/public/threads", publicThreadsApiRoutes);
    await services.settings.set("PUBLIC_API_ENABLED", "false");

    const res = await app.request("/api/public/threads");

    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("NOT_FOUND");
  });

  it("gives upload errors a code", async () => {
    const { app } = createTestApp({ authenticated: true });
    app.route("/api/upload", uploadApiRoutes);

    const noStorage = await app.request("/api/upload", {
      method: "POST",
      body: new FormData(),
    });
    expect(noStorage.status).toBe(500);
    expect((await errorOf(noStorage)).code).toBe("CONFIGURATION_ERROR");
  });

  it("answers a missing upload file with 400 VALIDATION_ERROR", async () => {
    const storage = {
      async put() {},
      async get() {
        return null;
      },
      async delete() {},
    };
    const { app } = createTestApp({
      authenticated: true,
      storage: storage as never,
    });
    app.route("/api/upload", uploadApiRoutes);

    const res = await app.request("/api/upload", {
      method: "POST",
      body: new FormData(),
    });

    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("VALIDATION_ERROR");
  });

  it("answers an error no handler expected with 500 INTERNAL_ERROR", async () => {
    const app = new Hono();
    app.onError(errorHandler as never);
    app.notFound(notFoundHandler as never);
    app.get("/api/boom", () => {
      throw new Error("boom");
    });

    const res = await app.request("/api/boom");

    expect(res.status).toBe(500);
    expect((await errorOf(res)).code).toBe("INTERNAL_ERROR");
  });
});
