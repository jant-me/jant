import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { getCorsOrigins } from "../../lib/env.js";
import type { Bindings } from "../../types.js";
import { apiCors } from "../cors.js";

describe("getCorsOrigins", () => {
  it("allows every origin when CORS_ORIGINS is unset or *", () => {
    expect(getCorsOrigins({})).toBe("*");
    expect(getCorsOrigins({ CORS_ORIGINS: "*" })).toBe("*");
  });

  it("turns cross-origin access off when CORS_ORIGINS is set but empty", () => {
    expect(getCorsOrigins({ CORS_ORIGINS: "" })).toBeUndefined();
    expect(getCorsOrigins({ CORS_ORIGINS: "  " })).toBeUndefined();
  });

  it("lists the origins it names", () => {
    expect(
      getCorsOrigins({
        CORS_ORIGINS: "https://a.example, chrome-extension://abc",
      }),
    ).toEqual(["https://a.example", "chrome-extension://abc"]);
  });
});

describe("apiCors", () => {
  function preflight(env: Record<string, string>) {
    const app = new Hono<{ Bindings: Bindings }>();
    app.use("/api/*", apiCors());
    app.get("/api/ping", (c) => c.text("ok"));
    return app.request(
      "/api/ping",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://elsewhere.example",
          "Access-Control-Request-Method": "GET",
        },
      },
      env as unknown as Bindings,
    );
  }

  it("answers a preflight when cross-origin access is on", async () => {
    const res = await preflight({});
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("sends no CORS headers when CORS_ORIGINS is empty", async () => {
    const res = await preflight({ CORS_ORIGINS: "" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
