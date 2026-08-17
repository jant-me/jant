import { describe, expect, it } from "vitest";
import { JANT_DOCS_BASE_URL, getJantDocsUrl } from "../jant-docs.js";

// Development builds are covered in jant-docs-dev.test.ts: flipping IS_VITE_DEV
// needs a hoisted module mock, which applies to a whole file.
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
});
