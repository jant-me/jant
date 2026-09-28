import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createTestDatabase } from "../../__tests__/helpers/db.js";
import type { Bindings } from "../../types.js";
import { isAllowedWrite, type WriteRequestInfo } from "../cross-origin.js";

const SESSION = "better-auth.session_token=abc.def";

function write(overrides: Partial<WriteRequestInfo>): WriteRequestInfo {
  return {
    method: "POST",
    cookie: SESSION,
    secFetchSite: undefined,
    origin: undefined,
    siteHosts: ["mine.jant.blog"],
    trustedOrigins: [],
    ...overrides,
  };
}

describe("isAllowedWrite", () => {
  it("lets reads through whatever their origin", () => {
    expect(
      isAllowedWrite(
        write({
          method: "GET",
          secFetchSite: "cross-site",
          origin: "https://evil.example",
        }),
      ),
    ).toBe(true);
  });

  it("lets a write without a session cookie through, since there's no session to borrow", () => {
    expect(
      isAllowedWrite(
        write({
          cookie: "theme=dark",
          secFetchSite: "cross-site",
          origin: "https://evil.example",
        }),
      ),
    ).toBe(true);
  });

  it("refuses a signed-in write from a sibling blog on the same parent domain", () => {
    expect(
      isAllowedWrite(
        write({ secFetchSite: "same-site", origin: "https://other.jant.blog" }),
      ),
    ).toBe(false);
  });

  it("refuses a signed-in write from another site", () => {
    expect(
      isAllowedWrite(
        write({ secFetchSite: "cross-site", origin: "https://evil.example" }),
      ),
    ).toBe(false);
  });

  it("accepts a write the site's own page sent", () => {
    expect(
      isAllowedWrite(
        write({
          secFetchSite: "same-origin",
          origin: "https://mine.jant.blog",
        }),
      ),
    ).toBe(true);
  });

  it("accepts an origin CORS_ORIGINS names, such as a browser extension", () => {
    expect(
      isAllowedWrite(
        write({
          secFetchSite: "cross-site",
          origin: "chrome-extension://abc",
          trustedOrigins: ["chrome-extension://abc"],
        }),
      ),
    ).toBe(true);
  });

  it("falls back to Origin for browsers without Sec-Fetch-Site", () => {
    expect(isAllowedWrite(write({ origin: "https://mine.jant.blog" }))).toBe(
      true,
    );
    expect(isAllowedWrite(write({ origin: "http://mine.jant.blog" }))).toBe(
      true,
    );
    expect(isAllowedWrite(write({ origin: "https://other.jant.blog" }))).toBe(
      false,
    );
    expect(isAllowedWrite(write({ origin: "null" }))).toBe(false);
  });

  it("lets a request with neither header through, since no page sent it", () => {
    expect(isAllowedWrite(write({}))).toBe(true);
  });
});

describe("cross-origin writes through createApp", () => {
  const executionCtx = {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as Parameters<ReturnType<typeof createApp>["fetch"]>[2];

  function bindings(): Bindings {
    const { sqlite } = createTestDatabase();
    return {
      SITE_ORIGIN: "https://mine.jant.blog",
      AUTH_SECRET: "x".repeat(40),
      NODE_SQLITE: sqlite,
    } as unknown as Bindings;
  }

  function postCodeInjection(headers: Record<string, string>) {
    return createApp().fetch(
      new Request("https://mine.jant.blog/settings/code-injection", {
        method: "POST",
        headers: { Cookie: SESSION, "Content-Type": "text/plain", ...headers },
        body: JSON.stringify({ customHeadHtml: "<script>alert(1)</script>" }),
      }),
      bindings(),
      executionCtx,
    );
  }

  it("refuses a form another blog auto-submits to code injection", async () => {
    const res = await postCodeInjection({
      Origin: "https://other.jant.blog",
      "Sec-Fetch-Site": "same-site",
    });

    expect(res.status).toBe(403);
    await expect(res.text()).resolves.toContain("started on another site");
  });

  it("leaves the site's own requests to the routes", async () => {
    const res = await postCodeInjection({
      Origin: "https://mine.jant.blog",
      "Sec-Fetch-Site": "same-origin",
    });

    expect(res.status).not.toBe(403);
  });
});
