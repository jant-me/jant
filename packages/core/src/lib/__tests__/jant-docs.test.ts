import { afterEach, describe, expect, it, vi } from "vitest";
import { JANT_DOCS_BASE_URL, getJantDocsUrl } from "../jant-docs.js";

afterEach(() => {
  vi.doUnmock("../build-env.js");
  vi.resetModules();
});

describe("getJantDocsUrl", () => {
  it("links a page on the released docs site", () => {
    expect(getJantDocsUrl("multilingual")).toBe(
      "https://jant.me/docs/multilingual",
    );
  });

  it("keeps section anchors", () => {
    expect(getJantDocsUrl("configuration#required")).toBe(
      "https://jant.me/docs/configuration#required",
    );
  });

  it("links the documentation index when no page is given", () => {
    expect(getJantDocsUrl()).toBe("https://jant.me/docs");
    expect(JANT_DOCS_BASE_URL).toBe("https://jant.me/docs");
  });

  it("links the local control plane in development builds", async () => {
    vi.resetModules();
    vi.doMock("../build-env.js", () => ({ IS_VITE_DEV: true }));

    const { getJantDocsUrl: getDevDocsUrl } = await import("../jant-docs.js");

    expect(getDevDocsUrl("multilingual")).toBe(
      "https://jant-cloud.localtest.me/docs/multilingual",
    );
  });
});
