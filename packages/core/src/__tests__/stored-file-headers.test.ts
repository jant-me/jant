/**
 * A stored file answers on the site's own origin. Opened directly, an HTML or
 * SVG file must not run scripts there, whatever headers it was stored with.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createLocalDriver } from "../lib/storage.js";
import type { Bindings } from "../types.js";
import { createTestDatabase, DEFAULT_TEST_SITE_ID } from "./helpers/db.js";

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as Parameters<ReturnType<typeof createApp>["fetch"]>[2];

let rootPath: string | undefined;

afterEach(() => {
  if (rootPath) rmSync(rootPath, { recursive: true, force: true });
  rootPath = undefined;
});

async function serve(file: {
  name: string;
  contentType: string;
  contentDisposition?: string;
}) {
  rootPath = mkdtempSync(join(tmpdir(), "jant-stored-file-"));
  const key = `media/${DEFAULT_TEST_SITE_ID}/files/${file.name}`;
  await createLocalDriver({ rootPath }).put(
    key,
    new TextEncoder().encode("<script>alert(1)</script>"),
    {
      contentType: file.contentType,
      contentDisposition: file.contentDisposition,
    },
  );

  const { sqlite } = createTestDatabase();
  const bindings = {
    SITE_ORIGIN: "https://blog.example",
    AUTH_SECRET: "x".repeat(40),
    NODE_SQLITE: sqlite,
    STORAGE_DRIVER: "local",
    LOCAL_STORAGE_PATH: rootPath,
  } as unknown as Bindings;

  return createApp().fetch(
    new Request(`https://blog.example/${key}`),
    bindings,
    executionCtx,
  );
}

describe("stored file headers", () => {
  it("sandboxes an HTML file stored inline", async () => {
    const res = await serve({
      name: "med_1.html",
      contentType: "text/html",
      contentDisposition: "inline",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("sandboxes an SVG", async () => {
    const res = await serve({
      name: "med_2.svg",
      contentType: "image/svg+xml",
    });

    expect(res.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("leaves a PDF to the browser's viewer", async () => {
    const res = await serve({
      name: "med_3.pdf",
      contentType: "application/pdf",
      contentDisposition: "inline",
    });

    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
