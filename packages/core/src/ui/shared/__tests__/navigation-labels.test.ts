import type { I18n, MessageDescriptor } from "@lingui/core";
import { describe, expect, it } from "vitest";
import {
  getNavItemDisplayLabel,
  getSystemNavDescription,
  getSystemNavDisplayLabel,
} from "../navigation-labels.js";

const i18n = {
  _(descriptor: MessageDescriptor) {
    return `translated:${descriptor.message}`;
  },
} satisfies Pick<I18n, "_">;

describe("getNavItemDisplayLabel", () => {
  it("translates system items with empty label (default)", () => {
    expect(
      getNavItemDisplayLabel(
        { type: "system", systemKey: "latest", label: "", url: "/latest" },
        i18n,
      ),
    ).toBe("translated:Latest");
    expect(
      getNavItemDisplayLabel(
        { type: "system", systemKey: "featured", label: "", url: "/featured" },
        i18n,
      ),
    ).toBe("translated:Featured");
    expect(
      getNavItemDisplayLabel(
        {
          type: "system",
          systemKey: "collections",
          label: "",
          url: "/collections",
        },
        i18n,
      ),
    ).toBe("translated:Collections");
    expect(
      getNavItemDisplayLabel(
        { type: "system", systemKey: "settings", label: "", url: "/settings" },
        i18n,
      ),
    ).toBe("translated:Settings");
    expect(
      getNavItemDisplayLabel(
        { type: "system", systemKey: "rss", label: "", url: "/feed" },
        i18n,
      ),
    ).toBe("translated:RSS");
  });

  it("translates prefixed public archive system items", () => {
    expect(
      getNavItemDisplayLabel(
        {
          type: "system",
          systemKey: "archive",
          label: "",
          url: "/blog/archive",
        },
        i18n,
        "/blog",
      ),
    ).toBe("translated:All");
  });

  it("uses custom label for system item when label is non-empty", () => {
    expect(
      getNavItemDisplayLabel(
        {
          type: "system",
          systemKey: "collections",
          label: "Topics",
          url: "/collections",
        },
        i18n,
      ),
    ).toBe("Topics");
  });

  it("preserves explicit English label as custom override", () => {
    expect(
      getNavItemDisplayLabel(
        {
          type: "system",
          systemKey: "latest",
          label: "Latest",
          url: "/latest",
        },
        i18n,
      ),
    ).toBe("Latest");
  });

  it("leaves custom links untouched", () => {
    expect(
      getNavItemDisplayLabel(
        { type: "link", label: "Collections", url: "/notes" },
        i18n,
      ),
    ).toBe("Collections");
  });

  it("does not translate matching custom links even if the path matches", () => {
    expect(
      getNavItemDisplayLabel(
        { type: "link", label: "Collections", url: "/collections" },
        i18n,
      ),
    ).toBe("Collections");
  });

  it("uses the stored label for collection nav items", () => {
    expect(
      getNavItemDisplayLabel(
        { type: "collection", label: "Design Notes", url: "/design-notes" },
        i18n,
      ),
    ).toBe("Design Notes");
  });
});

describe("system nav labels", () => {
  it("translates built-in system nav titles", () => {
    expect(getSystemNavDisplayLabel("latest", i18n)).toBe("translated:Latest");
    expect(getSystemNavDisplayLabel("featured", i18n)).toBe(
      "translated:Featured",
    );
    expect(getSystemNavDisplayLabel("collections", i18n)).toBe(
      "translated:Collections",
    );
    expect(getSystemNavDisplayLabel("archive", i18n)).toBe("translated:All");
    expect(getSystemNavDisplayLabel("rss", i18n)).toBe("translated:RSS");
  });

  it("translates system nav descriptions", () => {
    expect(getSystemNavDescription("latest", i18n)).toBe(
      "translated:Link to your latest posts. Your homepage shows this feed.",
    );
    expect(getSystemNavDescription("featured", i18n)).toBe(
      "translated:Link to posts you've marked as featured.",
    );
    expect(getSystemNavDescription("archive", i18n)).toBe(
      "translated:Link to the post archive",
    );
    expect(getSystemNavDescription("rss", i18n)).toBe(
      "translated:Add a link to your main RSS feed. Change what /feed returns in General.",
    );
  });
});
