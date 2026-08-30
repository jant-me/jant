// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testOnly } from "../media-scroll-hint.js";

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly observed = new Set<globalThis.Element>();

  constructor(private readonly callback: () => void) {
    TestResizeObserver.instances.push(this);
  }

  observe(target: globalThis.Element): void {
    this.observed.add(target);
  }

  unobserve(target: globalThis.Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  trigger(): void {
    this.callback();
  }
}

/** happy-dom reports every layout box as zero, so stub the metrics we read. */
function setMetrics(
  el: HTMLElement,
  metrics: { clientWidth: number; scrollWidth: number; scrollLeft?: number },
): void {
  Object.defineProperty(el, "clientWidth", {
    value: metrics.clientWidth,
    configurable: true,
  });
  Object.defineProperty(el, "scrollWidth", {
    value: metrics.scrollWidth,
    configurable: true,
  });
  Object.defineProperty(el, "scrollLeft", {
    value: metrics.scrollLeft ?? 0,
    configurable: true,
    writable: true,
  });
}

function renderGallery(): { wrap: HTMLElement; scroller: HTMLElement } {
  document.body.innerHTML = `
    <div class="media-gallery-scroll-wrap">
      <div data-post-media tabindex="0">
        <a class="media-visual-frame"></a>
        <a class="media-visual-frame"></a>
      </div>
      <button class="media-gallery-nav media-gallery-nav-prev"></button>
      <button class="media-gallery-nav media-gallery-nav-next"></button>
    </div>
  `;

  const wrap = document.querySelector<HTMLElement>(
    ".media-gallery-scroll-wrap",
  );
  const scroller = document.querySelector<HTMLElement>("[data-post-media]");
  if (!wrap || !scroller) throw new Error("Expected a gallery in the document");
  return { wrap, scroller };
}

/** Let happy-dom deliver its (microtask-scheduled) MutationObserver records. */
async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("media scroll hint", () => {
  beforeEach(() => {
    TestResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: globalThis.FrameRequestCallback) => {
        cb(0);
        return 0;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("marks the end edge while the strip overflows", () => {
    const { wrap, scroller } = renderGallery();
    setMetrics(scroller, { clientWidth: 400, scrollWidth: 760 });

    __testOnly.initWrap(wrap);

    expect(wrap.classList.contains("can-scroll-end")).toBe(true);
    expect(wrap.classList.contains("can-scroll-start")).toBe(false);
  });

  it("clears the end edge once the strip grows wide enough to fit", () => {
    const { wrap, scroller } = renderGallery();
    setMetrics(scroller, { clientWidth: 400, scrollWidth: 760 });

    __testOnly.initWrap(wrap);
    expect(wrap.classList.contains("can-scroll-end")).toBe(true);

    // A wider window (or a late-settling layout). Nothing overflows any more,
    // so no scroll event can fire — only the resize observer can correct it.
    setMetrics(scroller, { clientWidth: 760, scrollWidth: 760 });
    TestResizeObserver.instances[0]?.trigger();

    expect(wrap.classList.contains("can-scroll-end")).toBe(false);
  });

  it("observes the strip and each of its items", () => {
    const { wrap, scroller } = renderGallery();
    setMetrics(scroller, { clientWidth: 760, scrollWidth: 760 });

    __testOnly.initWrap(wrap);

    const observer = TestResizeObserver.instances[0];
    expect(observer?.observed.has(scroller)).toBe(true);
    for (const item of scroller.children) {
      expect(observer?.observed.has(item)).toBe(true);
    }
  });

  it("re-observes items swapped in after a morph", async () => {
    const { wrap, scroller } = renderGallery();
    setMetrics(scroller, { clientWidth: 760, scrollWidth: 760 });

    __testOnly.initWrap(wrap);
    expect(wrap.classList.contains("can-scroll-end")).toBe(false);

    scroller.innerHTML = `
      <a class="media-visual-frame"></a>
      <a class="media-visual-frame"></a>
      <a class="media-visual-frame"></a>
    `;
    setMetrics(scroller, { clientWidth: 760, scrollWidth: 1140 });
    await flushMutations();

    const observer = TestResizeObserver.instances[0];
    for (const item of scroller.children) {
      expect(observer?.observed.has(item)).toBe(true);
    }
    expect(wrap.classList.contains("can-scroll-end")).toBe(true);
  });
});
