import type { I18n, MessageDescriptor } from "@lingui/core";
import { describe, expect, it } from "vitest";
import { getSystemNavDescription } from "../system-nav-descriptions.js";

const i18n = {
  _(descriptor: MessageDescriptor, values?: Record<string, unknown>) {
    const message = descriptor.message ?? "";
    return values
      ? message.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))
      : message;
  },
} satisfies Pick<I18n, "_">;

describe("getSystemNavDescription", () => {
  it("describes each system nav toggle", () => {
    expect(getSystemNavDescription("latest", i18n)).toBe(
      "Link to your latest posts. Your homepage shows this feed.",
    );
    expect(getSystemNavDescription("featured", i18n)).toBe(
      "Link to posts you've marked as featured.",
    );
    expect(getSystemNavDescription("archive", i18n)).toBe(
      "Link to the post archive",
    );
  });

  it("names which end the RSS entry currently points at", () => {
    expect(getSystemNavDescription("rss", i18n, { feed: "Latest" })).toContain(
      "currently your Latest feed",
    );
  });

  // The two feed entries are the only pair an author has to choose between, so
  // each has to say who it is for. Losing either half loses the choice.
  it("tells the two feed entries apart by who they are for", () => {
    const rss = getSystemNavDescription("rss", i18n, { feed: "Latest" });
    const subscribe = getSystemNavDescription("subscribe", i18n);

    expect(rss).toContain("/feed");
    expect(rss).toContain("already use a feed reader");
    expect(subscribe).toContain("/subscribe");
    expect(subscribe).toContain("don't already use one");
  });
});
