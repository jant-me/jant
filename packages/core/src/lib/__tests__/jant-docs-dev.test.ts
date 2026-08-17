import { describe, expect, it, vi } from "vitest";

// Hoisted so the flag is mocked before jant-docs.js reads it at module scope.
vi.mock("../build-env.js", () => ({
  IS_VITE_DEV: true,
}));

const { JANT_DOCS_BASE_URL, getJantDocsUrl } = await import("../jant-docs.js");

describe("getJantDocsUrl in development builds", () => {
  it("links a page on the local control plane", () => {
    expect(getJantDocsUrl("multilingual")).toBe(
      "https://jant-cloud.localtest.me/docs/multilingual",
    );
  });

  it("links the documentation index when no page is given", () => {
    expect(getJantDocsUrl()).toBe("https://jant-cloud.localtest.me/docs");
    expect(JANT_DOCS_BASE_URL).toBe("https://jant-cloud.localtest.me/docs");
  });
});
