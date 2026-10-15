import { describe, expect, it } from "vitest";
import { getIconInnerSvg, getIconSvg, LUCIDE_ICON_NAMES } from "../icons.js";

describe("getIconSvg", () => {
  it("returns the Lucide SVG for a name", () => {
    const svg = getIconSvg("rss");
    expect(svg).toContain("<svg");
    expect(svg).toContain('class="lucide lucide-rss"');
  });

  it("appends extra classes to Lucide's own", () => {
    expect(getIconSvg("funnel", "icon-fine")).toContain(
      'class="lucide lucide-funnel icon-fine"',
    );
  });

  // A name maps to an import by hand, so the type check can't see
  // `"arrow-left": ArrowRight`. Lucide names its own class after the icon.
  it.each(LUCIDE_ICON_NAMES)("lists %s under its Lucide name", (name) => {
    expect(getIconSvg(name)).toContain(`class="lucide lucide-${name}"`);
  });
});

describe("getIconInnerSvg", () => {
  it("returns the children without the <svg> wrapper", () => {
    const inner = getIconInnerSvg("pencil");
    expect(inner).toContain("<path");
    expect(inner).not.toContain("<svg");
    expect(inner).not.toContain("</svg>");
  });
});
