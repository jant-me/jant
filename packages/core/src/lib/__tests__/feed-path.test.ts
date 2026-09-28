import { describe, expect, it } from "vitest";
import { isRssFeedPath } from "../feed-path.js";

describe("isRssFeedPath", () => {
  it.each([
    "/feed",
    "/feed/latest",
    "/feed/atom.xml",
    "/latest/feed",
    "/featured/feed/atom.xml",
    "/archive/feed",
    "/reading/feed",
    "/settings-notes/feed",
    "/collections/reading+movies/feed",
  ])("recognizes %s as a feed path", (path) => {
    expect(isRssFeedPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/archive",
    "/api/example/feed",
    "/settings/feed",
    "/compose/feed",
    "/_/theme/feed",
  ])("does not treat %s as a feed path", (path) => {
    expect(isRssFeedPath(path)).toBe(false);
  });
});
