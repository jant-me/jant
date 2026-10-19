import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { errorHandler } from "../error-handler.js";
import { declaredRequest, validate } from "../validate.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const NoteSchema = z.object({
  title: z.string().min(1, "Give the note a title"),
  tags: z.array(z.string()).optional(),
});

const ListQuerySchema = z.object({
  id: z.array(z.string()).max(2, "At most two").optional(),
  limit: z.coerce.number().int().optional(),
});

const UploadFormSchema = z.object({
  file: z.instanceof(File).optional(),
  alt: z.string().optional(),
});

function createTestApp() {
  const app = new Hono<Env>();
  app.onError(errorHandler);
  const notes = new Hono<Env>();
  notes.post("/", validate("json", NoteSchema), (c) =>
    c.json(c.req.valid("json")),
  );
  notes.get("/", validate("query", ListQuerySchema), (c) =>
    c.json(c.req.valid("query")),
  );
  notes.post("/upload", validate("form", UploadFormSchema), (c) => {
    const { file, alt } = c.req.valid("form");
    return c.json({ name: file?.name ?? null, alt: alt ?? null });
  });
  app.route("/api/notes", notes);
  return app;
}

describe("validate", () => {
  describe("json", () => {
    it("hands the handler the parsed body", async () => {
      const response = await createTestApp().request("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Hello", tags: ["a"], extra: 1 }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ title: "Hello", tags: ["a"] });
    });

    it("reads a JSON body sent without a Content-Type", async () => {
      const response = await createTestApp().request("/api/notes", {
        method: "POST",
        body: JSON.stringify({ title: "Hello" }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ title: "Hello" });
    });

    it("answers an invalid body with the first issue", async () => {
      const response = await createTestApp().request("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "Give the note a title",
        code: "VALIDATION_ERROR",
      });
    });

    it("answers a body that isn't JSON with a 400", async () => {
      const response = await createTestApp().request("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining("isn't valid JSON"),
      });
    });
  });

  describe("query", () => {
    it("reads each parameter's first value", async () => {
      const response = await createTestApp().request(
        "/api/notes?limit=5&limit=9",
      );

      expect(await response.json()).toEqual({ limit: 5 });
    });

    it("reads every value of a parameter the schema takes as an array", async () => {
      const response = await createTestApp().request("/api/notes?id=a&id=b");

      expect(await response.json()).toEqual({ id: ["a", "b"] });
    });

    it("validates the array it reads", async () => {
      const response = await createTestApp().request(
        "/api/notes?id=a&id=b&id=c",
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "At most two" });
    });
  });

  describe("form", () => {
    it("hands the handler files and text fields", async () => {
      const form = new FormData();
      form.append("file", new File(["hi"], "note.txt", { type: "text/plain" }));
      form.append("alt", "A note");

      const response = await createTestApp().request("/api/notes/upload", {
        method: "POST",
        body: form,
      });

      expect(await response.json()).toEqual({
        name: "note.txt",
        alt: "A note",
      });
    });

    it("answers a body that isn't form data with a 400", async () => {
      const response = await createTestApp().request("/api/notes/upload", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=x" },
        body: "not a form",
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining("isn't valid form data"),
      });
    });
  });

  it("leaves what a route accepts readable from the app's routes", () => {
    const declared = createTestApp()
      .routes.map((route) => ({
        route: `${route.method} ${route.path}`,
        request: declaredRequest(route.handler),
      }))
      .filter(({ request }) => request);

    expect(declared).toEqual([
      {
        route: "POST /api/notes",
        request: { target: "json", schema: NoteSchema },
      },
      {
        route: "GET /api/notes",
        request: { target: "query", schema: ListQuerySchema },
      },
      {
        route: "POST /api/notes/upload",
        request: { target: "form", schema: UploadFormSchema },
      },
    ]);
  });

  it("declares nothing for another handler", () => {
    expect(declaredRequest(() => undefined)).toBeUndefined();
    expect(declaredRequest("validate")).toBeUndefined();
  });
});
