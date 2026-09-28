import { describe, expect, it } from "vitest";
import { createTestApp } from "../../__tests__/helpers/app.js";
import { requirePublicApiEnabled } from "../public-content-access.js";

describe("public API access policy", () => {
  it("returns 404 for the dedicated public API even with a session", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    await services.settings.set("PUBLIC_API_ENABLED", "false");
    app.get("/api/public/data", requirePublicApiEnabled(), (c) =>
      c.json({ ok: true }),
    );

    const response = await app.request("/api/public/data");

    expect(response.status).toBe(404);
  });
});
