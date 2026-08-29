import type { EditorView } from "@tiptap/pm/view";

export interface FloatingAnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface FloatingContainerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FloatingPositionOptions {
  anchorRect: FloatingAnchorRect;
  containerRect: FloatingContainerRect;
  floatingWidth: number;
  floatingHeight: number;
  preferredPlacement: "top" | "bottom";
  fallbackPlacement?: "top" | "bottom";
  align: "center" | "start";
  gap?: number;
  padding?: number;
}

export interface FloatingPositionResult {
  left: number;
  top: number;
  placement: "top" | "bottom";
  maxHeight: number | null;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function getAvailableSpace(
  placement: "top" | "bottom",
  anchorRect: FloatingAnchorRect,
  containerRect: FloatingContainerRect,
  gap: number,
  padding: number,
): number {
  const containerTop = containerRect.top;
  const containerBottom = containerRect.top + containerRect.height;

  if (placement === "top") {
    return Math.max(anchorRect.top - containerTop - gap - padding, 0);
  }

  return Math.max(containerBottom - anchorRect.bottom - gap - padding, 0);
}

/**
 * Returns the viewport-relative bounds for a fixed-position floating surface.
 *
 * @param container - Fixed-position containing element, usually a dialog
 * @returns Rectangle in viewport coordinates
 *
 * @example
 * const rect = getFixedFloatingContainerRect(dialogEl);
 */
export function getFixedFloatingContainerRect(
  container: HTMLElement | null,
): FloatingContainerRect {
  if (!container || container === document.body) {
    return {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  const rect = container.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Computes a bounded position for floating editor UI inside a dialog-sized
 * fixed-position container.
 *
 * @param options - Anchor, container, and sizing information
 * @returns Position, placement, and constrained max height
 *
 * @example
 * const layout = getFloatingPosition({
 *   anchorRect: { left: 100, right: 160, top: 200, bottom: 220 },
 *   containerRect: getFixedFloatingContainerRect(dialogEl),
 *   floatingWidth: 180,
 *   floatingHeight: 48,
 *   preferredPlacement: "top",
 *   fallbackPlacement: "bottom",
 *   align: "center",
 * });
 */
export function getFloatingPosition(
  options: FloatingPositionOptions,
): FloatingPositionResult {
  const gap = options.gap ?? 8;
  const padding = options.padding ?? 8;
  const fallbackPlacement =
    options.fallbackPlacement ??
    (options.preferredPlacement === "top" ? "bottom" : "top");

  const preferredSpace = getAvailableSpace(
    options.preferredPlacement,
    options.anchorRect,
    options.containerRect,
    gap,
    padding,
  );
  const fallbackSpace = getAvailableSpace(
    fallbackPlacement,
    options.anchorRect,
    options.containerRect,
    gap,
    padding,
  );

  const placement =
    options.floatingHeight <= preferredSpace || preferredSpace >= fallbackSpace
      ? options.preferredPlacement
      : fallbackPlacement;
  const availableSpace =
    placement === options.preferredPlacement ? preferredSpace : fallbackSpace;
  const maxHeight =
    availableSpace > 0 && options.floatingHeight > availableSpace
      ? availableSpace
      : null;
  const usedHeight = maxHeight ?? options.floatingHeight;

  const desiredLeft =
    options.align === "center"
      ? (options.anchorRect.left + options.anchorRect.right) / 2 -
        options.floatingWidth / 2
      : options.anchorRect.left;
  const minLeft = padding;
  const maxLeft = options.containerRect.width - options.floatingWidth - padding;
  const left = clamp(
    desiredLeft - options.containerRect.left,
    minLeft,
    maxLeft,
  );

  const desiredTop =
    placement === "top"
      ? options.anchorRect.top - options.containerRect.top - usedHeight - gap
      : options.anchorRect.bottom - options.containerRect.top + gap;
  const minTop = padding;
  const maxTop = options.containerRect.height - usedHeight - padding;
  const top = clamp(desiredTop, minTop, maxTop);

  return {
    left,
    top,
    placement,
    maxHeight,
  };
}

/** Overflow values that clip a descendant out of view. */
const CLIPPING_OVERFLOW = new Set([
  "auto",
  "scroll",
  "hidden",
  "clip",
  "overlay",
]);

function intersectRects(
  a: FloatingContainerRect,
  b: FloatingContainerRect,
): FloatingContainerRect {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Narrows a floating container down to the region where the editor's content
 * is actually on screen, by intersecting it with every clipping ancestor.
 *
 * The composer's editor sits inside its own scroll region, so a selection can
 * run well past what the reader can see. Anchoring to the raw container would
 * point the surface at text hidden behind the scroll edge; this keeps the
 * anchor inside the scrollport.
 *
 * @param element - Editor element whose visible region is wanted
 * @param containerRect - Bounds of the fixed-position floating container
 * @returns Visible region in viewport coordinates
 *
 * @example
 * const clip = getVisibleClipRect(view.dom, getFixedFloatingContainerRect(dialog));
 */
export function getVisibleClipRect(
  element: HTMLElement,
  containerRect: FloatingContainerRect,
): FloatingContainerRect {
  let clip = containerRect;
  let node = element.parentElement;

  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (
      CLIPPING_OVERFLOW.has(style.overflowY) ||
      CLIPPING_OVERFLOW.has(style.overflowX)
    ) {
      const rect = node.getBoundingClientRect();
      const next = intersectRects(clip, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
      // A zero-size intersection means the ancestor reported no layout at all
      // (detached nodes, test environments). Keep the wider region instead of
      // collapsing the anchor to nothing.
      if (next.width > 0 && next.height > 0) clip = next;
    }
    node = node.parentElement;
  }

  return clip;
}

/**
 * Reduces the line boxes of a selection to the rectangle a floating surface
 * should point at.
 *
 * Horizontally this is the union of everything visible, so a selection that
 * covers whole blocks centers on the text column rather than on wherever the
 * first and last lines happen to break. Vertically it is the *first* visible
 * line only: a selection running past the bottom of the screen still gets an
 * anchor the reader can see, and flipping the surface below that line lands it
 * inside the selection instead of somewhere off-screen.
 *
 * @param rects - Client rects of the selection, in viewport coordinates
 * @param clipRect - Region the anchor must stay inside
 * @returns Anchor rectangle, or null when nothing is visible
 *
 * @example
 * const anchor = getVisibleAnchorRect(range.getClientRects(), clipRect);
 */
export function getVisibleAnchorRect(
  rects: readonly FloatingAnchorRect[],
  clipRect: FloatingContainerRect,
): FloatingAnchorRect | null {
  const clipRight = clipRect.left + clipRect.width;
  const clipBottom = clipRect.top + clipRect.height;

  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  let found = false;

  for (const rect of rects) {
    const rectTop = Math.max(rect.top, clipRect.top);
    const rectBottom = Math.min(rect.bottom, clipBottom);
    if (rectBottom <= rectTop) continue;
    const rectLeft = Math.max(rect.left, clipRect.left);
    const rectRight = Math.min(rect.right, clipRight);
    if (rectRight < rectLeft) continue;

    left = Math.min(left, rectLeft);
    right = Math.max(right, rectRight);
    top = Math.min(top, rectTop);
    // Every kept rect ends below `top`, so the smallest bottom belongs to the
    // shortest box starting there — the first line, even when the browser also
    // reports a full-height rect for an enclosing block.
    bottom = Math.min(bottom, rectBottom);
    found = true;
  }

  return found ? { left, right, top, bottom } : null;
}

function measureRangeRects(
  view: EditorView,
  from: number,
  to: number,
): FloatingAnchorRect[] {
  if (typeof document === "undefined" || !document.createRange) return [];

  try {
    const start = view.domAtPos(from);
    const end = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const rects = range.getClientRects?.();
    return rects ? Array.from(rects) : [];
  } catch {
    // Positions that do not resolve to a DOM range (node selections, widgets)
    // fall back to the caller's endpoint coordinates.
    return [];
  }
}

/**
 * Resolves the rectangle a floating surface should point at for a document
 * range.
 *
 * Measuring the caret at each end is only correct while the range stays on one
 * line: as soon as it wraps, the "anchor" mixes the first line's left edge with
 * the last line's right edge and centers on a point inside neither. This
 * measures the range's real line boxes instead.
 *
 * @param view - Editor view owning the range
 * @param from - Range start position
 * @param to - Range end position
 * @param clipRect - Region the anchor must stay inside
 * @returns Anchor rectangle in viewport coordinates
 *
 * @example
 * const anchor = getRangeAnchorRect(view, from, to, clipRect);
 */
export function getRangeAnchorRect(
  view: EditorView,
  from: number,
  to: number,
  clipRect: FloatingContainerRect,
): FloatingAnchorRect {
  const measured = getVisibleAnchorRect(
    measureRangeRects(view, from, to),
    clipRect,
  );
  if (measured) return measured;

  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  const endpoints: FloatingAnchorRect = {
    left: Math.min(start.left, end.left),
    right: Math.max(start.right, end.right),
    top: start.top,
    bottom: start.bottom,
  };
  return getVisibleAnchorRect([endpoints], clipRect) ?? endpoints;
}

/**
 * Horizontal offset of a floating surface's pointer arrow, measured from the
 * surface's own left edge.
 *
 * The surface is clamped to the container, so a centered arrow drifts off the
 * anchor near the edges of the screen. This keeps it on the anchor without
 * letting it slide past the rounded corners.
 *
 * @param options - Anchor, container, and the surface's placed geometry
 * @returns Offset in pixels from the surface's left edge
 *
 * @example
 * el.style.setProperty("--floating-arrow-x", `${getFloatingArrowOffset({...})}px`);
 */
export function getFloatingArrowOffset(options: {
  anchorRect: FloatingAnchorRect;
  containerRect: FloatingContainerRect;
  floatingLeft: number;
  floatingWidth: number;
  inset?: number;
}): number {
  const inset = options.inset ?? 10;
  const anchorCenter =
    (options.anchorRect.left + options.anchorRect.right) / 2 -
    options.containerRect.left;
  const min = Math.min(inset, options.floatingWidth / 2);
  const max = Math.max(options.floatingWidth - inset, min);
  return clamp(anchorCenter - options.floatingLeft, min, max);
}
