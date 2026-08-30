/**
 * Media gallery horizontal scroll affordances.
 *
 * The gallery strip (`[data-post-media]` inside `.media-gallery-scroll-wrap`)
 * is trackpad- and touch-friendly, but its scrollbar is hidden, so a plain
 * mouse or the keyboard has no obvious way to scroll it. This module:
 *
 *  - Toggles `.can-scroll-start` / `.can-scroll-end` on the wrap so CSS can
 *    fade the edge that has hidden content and reveal the matching arrow,
 *    re-measuring on scroll and on any size change of the strip or its items.
 *  - Wires the prev/next arrow buttons to scroll the strip by one page.
 *  - Scrolls the strip with Arrow / Home / End keys while it is focused.
 */

const THRESHOLD = 4; // px tolerance for "at edge"

function getScroller(wrap: HTMLElement): HTMLElement | null {
  return wrap.querySelector("[data-post-media]");
}

function updateHints(wrap: HTMLElement): void {
  const scroller = getScroller(wrap);
  if (!scroller) return;

  const { scrollLeft, scrollWidth, clientWidth } = scroller;
  wrap.classList.toggle("can-scroll-start", scrollLeft > THRESHOLD);
  wrap.classList.toggle(
    "can-scroll-end",
    scrollLeft + clientWidth < scrollWidth - THRESHOLD,
  );
}

/** Horizontal distance moved per arrow-button click or arrow keypress. */
function pageStep(scroller: HTMLElement): number {
  return Math.max(160, Math.round(scroller.clientWidth * 0.85));
}

function scrollByStep(scroller: HTMLElement, direction: 1 | -1): void {
  scroller.scrollBy({
    left: direction * pageStep(scroller),
    behavior: "smooth",
  });
}

/**
 * Re-measure whenever the strip or its items change size.
 *
 * Scroll events alone are not enough: they only fire while the strip actually
 * overflows, so a hint measured against a narrower strip — a smaller window at
 * load time, a zoom change, an item that resolves its width late — latches on
 * forever. The arrow keeps pointing at content that is already fully visible,
 * and no scroll can ever happen to correct it.
 */
function watchLayout(wrap: HTMLElement, scroller: HTMLElement): void {
  if (!("ResizeObserver" in globalThis)) return;

  let raf = 0;
  const schedule = (): void => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => updateHints(wrap));
  };

  // The strip covers viewport and column width changes; its items cover
  // content width changes. Re-observe when a morph swaps the items out.
  const observer = new globalThis.ResizeObserver(schedule);
  const observeAll = (): void => {
    observer.disconnect();
    observer.observe(scroller);
    for (const item of scroller.children) observer.observe(item);
  };
  observeAll();
  new globalThis.MutationObserver(() => {
    observeAll();
    schedule();
  }).observe(scroller, { childList: true });
}

function initWrap(wrap: HTMLElement): void {
  // Guard against double-init (initAll + the MutationObserver can overlap).
  if (wrap.dataset.scrollHintReady === "1") return;
  const scroller = getScroller(wrap);
  if (!scroller) return;
  wrap.dataset.scrollHintReady = "1";

  // Initial check + keep edge hints in sync while scrolling and while the
  // strip is resized or its items change.
  updateHints(wrap);
  scroller.addEventListener("scroll", () => updateHints(wrap), {
    passive: true,
  });
  watchLayout(wrap, scroller);

  // Prev/next arrow buttons — the mouse affordance.
  wrap
    .querySelector(".media-gallery-nav-prev")
    ?.addEventListener("click", () => scrollByStep(scroller, -1));
  wrap
    .querySelector(".media-gallery-nav-next")
    ?.addEventListener("click", () => scrollByStep(scroller, 1));

  // Keyboard scrolling while the strip itself is focused.
  scroller.addEventListener("keydown", (event) => {
    if (event.target !== scroller) return;
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        scrollByStep(scroller, 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        scrollByStep(scroller, -1);
        break;
      case "Home":
        event.preventDefault();
        scroller.scrollTo({ left: 0, behavior: "smooth" });
        break;
      case "End":
        event.preventDefault();
        scroller.scrollTo({ left: scroller.scrollWidth, behavior: "smooth" });
        break;
    }
  });
}

// Init all existing galleries
function initAll(): void {
  document
    .querySelectorAll<HTMLElement>(".media-gallery-scroll-wrap")
    .forEach(initWrap);
}

// Handle dynamically added galleries (Datastar morph, etc.)
const observer = new globalThis.MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches(".media-gallery-scroll-wrap")) {
        initWrap(node);
      }
      node
        .querySelectorAll<HTMLElement>(".media-gallery-scroll-wrap")
        .forEach(initWrap);
    }
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initAll();
    observer.observe(document.body, { childList: true, subtree: true });
  });
} else {
  initAll();
  observer.observe(document.body, { childList: true, subtree: true });
}

export const __testOnly = {
  initWrap,
  updateHints,
};
