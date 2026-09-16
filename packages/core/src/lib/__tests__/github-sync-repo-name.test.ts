import { describe, expect, it } from "vitest";
import { suggestSyncRepoName } from "../github-sync-repo-name.js";

describe("suggestSyncRepoName", () => {
  it.each([
    ["https://notes.example.com", "notes-jant-sync"],
    ["https://Notes.Example.com/", "notes-jant-sync"],
    ["https://my_notes.example.com", "my_notes-jant-sync"],
    ["http://localhost:8787", "localhost-8787-jant-sync"],
  ])("derives %s into %s", (siteUrl, expected) => {
    expect(suggestSyncRepoName(siteUrl)).toBe(expected);
  });

  it("skips a leading www, which names nothing about the site", () => {
    expect(suggestSyncRepoName("https://www.owenyoung.com")).toBe(
      "owenyoung-jant-sync",
    );
    expect(suggestSyncRepoName("https://www.blog.example.co.uk")).toBe(
      "blog-jant-sync",
    );
  });

  it("keeps www when only a top-level domain follows it", () => {
    expect(suggestSyncRepoName("https://www.com")).toBe("www-jant-sync");
  });

  it("only skips the exact www label", () => {
    expect(suggestSyncRepoName("https://www2.example.com")).toBe(
      "www2-jant-sync",
    );
    expect(suggestSyncRepoName("https://wwwnotes.example.com")).toBe(
      "wwwnotes-jant-sync",
    );
  });

  it("never hands GitHub an empty name", () => {
    expect(suggestSyncRepoName("")).toBe("jant-site-sync");
    expect(suggestSyncRepoName("not a url")).toBe("jant-site-sync");
  });
});
