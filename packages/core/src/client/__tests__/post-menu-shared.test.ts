// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computePostMenuPlacement,
  isPostMenuSheetViewport,
  postMenuSurfaceStyle,
} from "../post-menu-shared.js";

function setViewport(width: number, height: number, scrollX = 0, scrollY = 0) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(window, "scrollX", {
    configurable: true,
    value: scrollX,
  });
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    value: scrollY,
  });
}

describe("post-menu-shared", () => {
  beforeEach(() => {
    setViewport(1280, 800);
    Object.defineProperty(globalThis, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });

  it("uses sheet mode at and below the 699px phone switch", () => {
    setViewport(390, 844);
    expect(isPostMenuSheetViewport()).toBe(true);

    setViewport(699, 844);
    expect(isPostMenuSheetViewport()).toBe(true);

    setViewport(700, 844);
    expect(isPostMenuSheetViewport()).toBe(false);
  });

  it("anchors below the trigger when the menu fits below", () => {
    setViewport(1280, 900);
    const placement = computePostMenuPlacement(
      { top: 200, bottom: 234, right: 760 },
      { panelHeight: 500, panelWidth: 240, estimatedHeight: 460 },
    );

    expect(placement).toEqual({
      x: 760,
      y: 240,
      anchorBottom: false,
      maxHeight: 876,
    });
  });

  it("anchors above the trigger when below is tight and above fits", () => {
    setViewport(1280, 900, 0, 300);
    const placement = computePostMenuPlacement(
      { top: 760, bottom: 794, right: 760 },
      { panelHeight: 500, panelWidth: 240, estimatedHeight: 460 },
    );

    expect(placement).toEqual({
      x: 760,
      y: 1054,
      anchorBottom: true,
      maxHeight: 876,
    });
    expect(postMenuSurfaceStyle(placement)).toContain(
      "transform:translate(-100%, -100%);",
    );
  });

  it("clamps inside the top margin when opening above would overflow off-screen", () => {
    // Pinned post near the top of the page (scrollY = 0) on a shorter viewport:
    // neither side alone fits a 560px menu, and spaceAbove > spaceBelow.
    setViewport(1024, 720, 0, 0);
    const placement = computePostMenuPlacement(
      { top: 390, bottom: 424, right: 760 },
      { panelHeight: 560, panelWidth: 240, estimatedHeight: 460 },
    );

    expect(placement.anchorBottom).toBe(false);
    expect(placement.y).toBe(12);
    expect(placement.maxHeight).toBe(696);
    expect(postMenuSurfaceStyle(placement)).toContain("top:12px;");
    expect(postMenuSurfaceStyle(placement)).toContain(
      "transform:translateX(-100%);",
    );
  });

  it("clamps inside the bottom margin when neither side fits and more room is below", () => {
    setViewport(1024, 720, 0, 0);
    const placement = computePostMenuPlacement(
      { top: 300, bottom: 334, right: 760 },
      { panelHeight: 560, panelWidth: 240, estimatedHeight: 460 },
    );

    expect(placement.anchorBottom).toBe(false);
    expect(placement.y).toBe(720 - 12 - 560);
    expect(placement.maxHeight).toBe(696);
  });

  it("caps maxHeight and pins to the top margin on very short viewports", () => {
    setViewport(1024, 420, 0, 100);
    const placement = computePostMenuPlacement(
      { top: 200, bottom: 234, right: 760 },
      { panelHeight: 560, panelWidth: 240, estimatedHeight: 460 },
    );

    expect(placement.anchorBottom).toBe(false);
    expect(placement.maxHeight).toBe(396);
    expect(placement.y).toBe(112);
  });

  it("clamps horizontally when a right-aligned panel would cross the left viewport edge", () => {
    setViewport(800, 900);
    const placement = computePostMenuPlacement(
      { top: 100, bottom: 134, right: 120 },
      { panelHeight: 300, panelWidth: 240, estimatedHeight: 300 },
    );

    // 12px left margin + 240px panel width = 252px right edge.
    expect(placement.x).toBe(252);
  });

  it("uses visualViewport bounds when available", () => {
    setViewport(1024, 800, 0, 0);
    Object.defineProperty(globalThis, "visualViewport", {
      configurable: true,
      value: {
        offsetTop: 40,
        offsetLeft: 0,
        width: 1024,
        height: 500,
      },
    });

    const placement = computePostMenuPlacement(
      { top: 300, bottom: 334, right: 760 },
      { panelHeight: 520, panelWidth: 240, estimatedHeight: 460 },
    );

    expect(placement.maxHeight).toBe(476);
    expect(placement.y).toBe(52);
  });
});
