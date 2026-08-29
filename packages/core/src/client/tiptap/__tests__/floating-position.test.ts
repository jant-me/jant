// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  getFloatingArrowOffset,
  getFloatingPosition,
  getVisibleAnchorRect,
  getVisibleClipRect,
} from "../floating-position.js";

describe("getFloatingPosition", () => {
  const containerRect = {
    left: 100,
    top: 50,
    width: 320,
    height: 240,
  };

  it("flips below the anchor when there is not enough room above", () => {
    const layout = getFloatingPosition({
      anchorRect: {
        left: 180,
        right: 240,
        top: 70,
        bottom: 90,
      },
      containerRect,
      floatingWidth: 120,
      floatingHeight: 48,
      preferredPlacement: "top",
      fallbackPlacement: "bottom",
      align: "center",
    });

    expect(layout.placement).toBe("bottom");
    expect(layout.top).toBeGreaterThanOrEqual(48);
  });

  it("clamps centered overlays within the container width", () => {
    const layout = getFloatingPosition({
      anchorRect: {
        left: 108,
        right: 130,
        top: 170,
        bottom: 190,
      },
      containerRect,
      floatingWidth: 180,
      floatingHeight: 40,
      preferredPlacement: "top",
      fallbackPlacement: "bottom",
      align: "center",
    });

    expect(layout.left).toBe(8);
  });

  it("returns a constrained max height when the popup is taller than the space", () => {
    const layout = getFloatingPosition({
      anchorRect: {
        left: 180,
        right: 180,
        top: 250,
        bottom: 270,
      },
      containerRect,
      floatingWidth: 160,
      floatingHeight: 220,
      preferredPlacement: "bottom",
      fallbackPlacement: "top",
      align: "start",
      gap: 4,
    });

    expect(layout.placement).toBe("top");
    expect(layout.maxHeight).toBe(188);
    expect(layout.top).toBe(8);
  });
});

describe("getVisibleAnchorRect", () => {
  // A three-line selection in a text column running from x=100 to x=300,
  // inside a scroll region showing y=50..250.
  const clipRect = { left: 100, top: 50, width: 220, height: 200 };
  const lines = [
    { left: 180, right: 300, top: 60, bottom: 80 },
    { left: 100, right: 300, top: 80, bottom: 100 },
    { left: 100, right: 160, top: 100, bottom: 120 },
  ];

  it("centers on the whole selection but hugs its first line", () => {
    const anchor = getVisibleAnchorRect(lines, clipRect);

    expect(anchor).toEqual({ left: 100, right: 300, top: 60, bottom: 80 });
  });

  it("ignores an enclosing block rect when picking the first line", () => {
    const anchor = getVisibleAnchorRect(
      [{ left: 100, right: 300, top: 60, bottom: 120 }, ...lines],
      clipRect,
    );

    expect(anchor?.bottom).toBe(80);
  });

  it("anchors to the first line still on screen when the selection scrolls past the top", () => {
    const anchor = getVisibleAnchorRect(
      [
        { left: 100, right: 300, top: -40, bottom: -20 },
        { left: 100, right: 300, top: -20, bottom: 0 },
        ...lines,
      ],
      clipRect,
    );

    expect(anchor).toEqual({ left: 100, right: 300, top: 60, bottom: 80 });
  });

  it("clips a selection that overruns the scroll region", () => {
    const anchor = getVisibleAnchorRect(
      [{ left: 100, right: 300, top: 20, bottom: 400 }],
      clipRect,
    );

    expect(anchor).toEqual({ left: 100, right: 300, top: 50, bottom: 250 });
  });

  it("returns null when nothing is visible", () => {
    const anchor = getVisibleAnchorRect(
      [{ left: 100, right: 300, top: 300, bottom: 320 }],
      clipRect,
    );

    expect(anchor).toBeNull();
  });
});

describe("getVisibleClipRect", () => {
  function stubRect(
    el: HTMLElement,
    rect: { left: number; top: number; width: number; height: number },
  ) {
    const measured = {
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    };
    el.getBoundingClientRect = () => measured;
  }

  it("narrows the container down to a scrolling ancestor", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    const content = document.createElement("div");
    scroller.appendChild(content);
    document.body.appendChild(scroller);
    stubRect(scroller, { left: 100, top: 120, width: 300, height: 200 });

    const clip = getVisibleClipRect(content, {
      left: 100,
      top: 50,
      width: 320,
      height: 400,
    });

    expect(clip).toEqual({ left: 100, top: 120, width: 300, height: 200 });
    scroller.remove();
  });

  it("keeps the container when no ancestor reports a clipping region", () => {
    const plain = document.createElement("div");
    const content = document.createElement("div");
    plain.appendChild(content);
    document.body.appendChild(plain);
    const containerRect = { left: 100, top: 50, width: 320, height: 400 };

    expect(getVisibleClipRect(content, containerRect)).toEqual(containerRect);
    plain.remove();
  });
});

describe("getFloatingArrowOffset", () => {
  const containerRect = { left: 100, top: 50, width: 320, height: 240 };

  it("points at the anchor center", () => {
    const offset = getFloatingArrowOffset({
      anchorRect: { left: 200, right: 240, top: 70, bottom: 90 },
      containerRect,
      floatingLeft: 60,
      floatingWidth: 160,
    });

    expect(offset).toBe(60);
  });

  it("stays inside the surface when it is clamped away from the anchor", () => {
    const offset = getFloatingArrowOffset({
      anchorRect: { left: 400, right: 420, top: 70, bottom: 90 },
      containerRect,
      floatingLeft: 8,
      floatingWidth: 160,
    });

    expect(offset).toBe(150);
  });
});
