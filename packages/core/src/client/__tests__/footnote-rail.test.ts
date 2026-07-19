// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initFootnoteRails, __testOnly } from "../footnote-rail.js";

let rectangles = new WeakMap<globalThis.Element, Partial<globalThis.DOMRect>>();
let animationFrameId = 0;
let animationFrames = new Map<number, (time: number) => void>();

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];

  readonly observed = new Set<globalThis.Element>();
  disconnected = false;

  constructor(
    readonly callback: (
      entries: globalThis.ResizeObserverEntry[],
      observer: globalThis.ResizeObserver,
    ) => void,
  ) {
    TestResizeObserver.instances.push(this);
  }

  observe(target: globalThis.Element): void {
    this.observed.add(target);
  }

  unobserve(target: globalThis.Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }
}

function rect(partial: Partial<globalThis.DOMRect>): globalThis.DOMRect {
  const top = partial.top ?? 0;
  const left = partial.left ?? 0;
  const width = partial.width ?? 0;
  const height = partial.height ?? 0;
  return {
    x: left,
    y: top,
    top,
    right: partial.right ?? left + width,
    bottom: partial.bottom ?? top + height,
    left,
    width,
    height,
    toJSON: () => ({}),
  };
}

function setRect(
  element: globalThis.Element,
  partial: Partial<globalThis.DOMRect>,
): void {
  rectangles.set(element, partial);
}

function flushAnimationFrames(): void {
  while (animationFrames.size > 0) {
    const pending = animationFrames;
    animationFrames = new Map();
    for (const callback of pending.values()) callback(0);
  }
}

function renderCanonicalFootnotes(): {
  body: HTMLElement;
  firstReference: HTMLAnchorElement;
  repeatedReference: HTMLAnchorElement;
  secondReference: HTMLAnchorElement;
  firstNote: globalThis.HTMLLIElement;
  secondNote: globalThis.HTMLLIElement;
  list: globalThis.HTMLOListElement;
} {
  document.body.innerHTML = `
    <div data-post-view>
      <article data-page="post">
        <div class="e-content prose post-detail-body" data-post-body>
          <p>First <sup class="footnote-ref"><a id="fnref-s-1-1" href="#fn-s-1" role="doc-noteref">1</a></sup></p>
          <p>Repeated <sup class="footnote-ref"><a id="fnref-s-1-2" href="#fn-s-1" role="doc-noteref">1</a></sup></p>
          <p>Second <sup class="footnote-ref"><a id="fnref-s-2-1" href="#fn-s-2" role="doc-noteref">2</a></sup></p>
          <section class="footnote-endnotes" role="doc-endnotes">
            <ol class="footnote-list">
              <li id="fn-s-1" class="footnote"><p>One <a href="#fnref-s-1-1" role="doc-backlink">↩︎</a></p></li>
              <li id="fn-s-2" class="footnote"><p>Two <a href="#fnref-s-2-1" role="doc-backlink">↩︎</a></p></li>
            </ol>
          </section>
        </div>
      </article>
    </div>
  `;

  const requireElement = <T extends globalThis.Element>(
    selector: string,
  ): T => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing test element: ${selector}`);
    return element;
  };

  return {
    body: requireElement<HTMLElement>("[data-post-body]"),
    firstReference: requireElement<HTMLAnchorElement>("#fnref-s-1-1"),
    repeatedReference: requireElement<HTMLAnchorElement>("#fnref-s-1-2"),
    secondReference: requireElement<HTMLAnchorElement>("#fnref-s-2-1"),
    firstNote: requireElement<globalThis.HTMLLIElement>("#fn-s-1"),
    secondNote: requireElement<globalThis.HTMLLIElement>("#fn-s-2"),
    list: requireElement<globalThis.HTMLOListElement>(".footnote-list"),
  };
}

function appendTimelineFootnotes(scope: string): {
  container: HTMLElement;
  body: HTMLElement;
  firstReference: HTMLAnchorElement;
  secondReference: HTMLAnchorElement;
  firstNote: globalThis.HTMLLIElement;
  secondNote: globalThis.HTMLLIElement;
} {
  const container = document.createElement("div");
  container.setAttribute("data-timeline-item", "");
  container.setAttribute("data-timeline-item-id", scope);
  container.innerHTML = `
    <div data-timeline-item-content>
      <article data-post="pst_${scope}">
        <div class="e-content prose post-body-summary" data-post-body>
          <p>First <sup class="footnote-ref"><a id="fnref-${scope}-1-1" href="#fn-${scope}-1" role="doc-noteref">1</a></sup></p>
          <p>Second <sup class="footnote-ref"><a id="fnref-${scope}-2-1" href="#fn-${scope}-2" role="doc-noteref">2</a></sup></p>
          <section class="footnote-endnotes" role="doc-endnotes">
            <ol class="footnote-list">
              <li id="fn-${scope}-1" class="footnote"><p>One <span class="footnote-backlinks"><a href="#fnref-${scope}-1-1" role="doc-backlink">↩︎</a></span></p></li>
              <li id="fn-${scope}-2" class="footnote"><p>Two <span class="footnote-backlinks"><a href="#fnref-${scope}-2-1" role="doc-backlink">↩︎</a></span></p></li>
            </ol>
          </section>
        </div>
      </article>
    </div>
  `;
  document.body.appendChild(container);

  const requireElement = <T extends globalThis.Element>(
    selector: string,
  ): T => {
    const element = container.querySelector<T>(selector);
    if (!element) throw new Error(`Missing timeline test element: ${selector}`);
    return element;
  };

  return {
    container,
    body: requireElement<HTMLElement>("[data-post-body]"),
    firstReference: requireElement<HTMLAnchorElement>(`#fnref-${scope}-1-1`),
    secondReference: requireElement<HTMLAnchorElement>(`#fnref-${scope}-2-1`),
    firstNote: requireElement<globalThis.HTMLLIElement>(`#fn-${scope}-1`),
    secondNote: requireElement<globalThis.HTMLLIElement>(`#fn-${scope}-2`),
  };
}

describe("footnote rail layout", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    globalThis.history.replaceState(null, "", "/");
    rectangles = new WeakMap<globalThis.Element, Partial<globalThis.DOMRect>>();
    animationFrameId = 0;
    animationFrames = new Map();
    TestResizeObserver.instances = [];

    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: (time: number) => void): number => {
        animationFrameId += 1;
        animationFrames.set(animationFrameId, callback);
        return animationFrameId;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
      animationFrames.delete(id);
    });
    vi.spyOn(
      globalThis.Element.prototype,
      "getBoundingClientRect",
    ).mockImplementation(function getBoundingClientRect(
      this: globalThis.Element,
    ): globalThis.DOMRect {
      return rect(rectangles.get(this) ?? {});
    });
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation(
      () =>
        ({
          getPropertyValue: (name: string) =>
            name === "--jant-footnote-rail-enabled" ? "1" : "",
          rowGap: "12px",
        }) as globalThis.CSSStyleDeclaration,
    );
  });

  afterEach(() => {
    __testOnly.resetControllers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    globalThis.history.replaceState(null, "", "/");
  });

  it("keeps sparse notes at their natural anchors", () => {
    expect(
      __testOnly.computeFootnoteRailLayout(
        [
          { anchorTop: 10, blockSize: 20 },
          { anchorTop: 50, blockSize: 10 },
        ],
        12,
      ),
    ).toEqual({ offsets: [10, 50], blockSize: 60 });
  });

  it("pushes colliding notes down without moving the first note", () => {
    expect(
      __testOnly.computeFootnoteRailLayout(
        [
          { anchorTop: 10, blockSize: 20 },
          { anchorTop: 15, blockSize: 30 },
        ],
        12,
      ),
    ).toEqual({ offsets: [10, 42], blockSize: 72 });
  });

  it("clamps invalid geometry instead of producing invalid CSS", () => {
    expect(
      __testOnly.computeFootnoteRailLayout(
        [
          { anchorTop: -10, blockSize: Number.NaN },
          { anchorTop: Number.POSITIVE_INFINITY, blockSize: 10 },
        ],
        -2,
      ),
    ).toEqual({ offsets: [0, 0], blockSize: 10 });
  });

  it("maps repeated references to the first occurrence", () => {
    const { body, firstReference, firstNote, secondNote } =
      renderCanonicalFootnotes();

    const structure = __testOnly.findFootnoteStructure(body);

    expect(structure?.pairs).toHaveLength(2);
    expect(structure?.pairs[0]).toMatchObject({
      reference: firstReference,
      note: firstNote,
    });
    expect(structure?.pairs[1]?.note).toBe(secondNote);
  });

  it("fails closed when an endnote has no matching reference", () => {
    const { body, secondReference } = renderCanonicalFootnotes();
    secondReference.remove();

    expect(__testOnly.findFootnoteStructure(body)).toBeNull();
  });

  it("positions the existing list and resolves a collision", () => {
    const {
      body,
      firstReference,
      repeatedReference,
      secondReference,
      firstNote,
      secondNote,
      list,
    } = renderCanonicalFootnotes();
    setRect(body, { top: 100, height: 200 });
    setRect(firstReference, { top: 110 });
    setRect(repeatedReference, { top: 118 });
    setRect(secondReference, { top: 130 });
    setRect(firstNote, { height: 30 });
    setRect(secondNote, { height: 40 });

    initFootnoteRails(document);
    flushAnimationFrames();

    expect(__testOnly.getControllerCount()).toBe(1);
    expect(body.classList.contains("footnote-rail-ready")).toBe(true);
    expect(firstNote.style.getPropertyValue("--footnote-rail-y")).toBe("10px");
    expect(secondNote.style.getPropertyValue("--footnote-rail-y")).toBe("52px");
    expect(firstNote.style.getPropertyValue("--footnote-rail-number")).toBe(
      '"1"',
    );
    expect(list.style.getPropertyValue("--footnote-rail-block-size")).toBe(
      "92px",
    );
    expect(body.style.minBlockSize).toBe("200px");
  });

  it("enhances each timeline item independently", () => {
    const first = appendTimelineFootnotes("timeline-a");
    const second = appendTimelineFootnotes("timeline-b");

    setRect(first.body, { top: 100, height: 180 });
    setRect(first.firstReference, { top: 110 });
    setRect(first.secondReference, { top: 150 });
    setRect(first.firstNote, { height: 20 });
    setRect(first.secondNote, { height: 20 });

    setRect(second.body, { top: 500, height: 180 });
    setRect(second.firstReference, { top: 515 });
    setRect(second.secondReference, { top: 560 });
    setRect(second.firstNote, { height: 24 });
    setRect(second.secondNote, { height: 24 });

    initFootnoteRails(document);
    flushAnimationFrames();

    expect(__testOnly.getControllerCount()).toBe(2);
    expect(first.body.classList.contains("footnote-rail-ready")).toBe(true);
    expect(second.body.classList.contains("footnote-rail-ready")).toBe(true);
    expect(first.firstNote.style.getPropertyValue("--footnote-rail-y")).toBe(
      "10px",
    );
    expect(second.firstNote.style.getPropertyValue("--footnote-rail-y")).toBe(
      "15px",
    );
    expect(TestResizeObserver.instances).toHaveLength(2);
    expect(TestResizeObserver.instances[0]?.observed.has(first.container)).toBe(
      true,
    );
    expect(
      TestResizeObserver.instances[1]?.observed.has(second.container),
    ).toBe(true);
  });

  it("hydrates a swapped timeline item and cleans up detached controllers", () => {
    const detail = renderCanonicalFootnotes();
    const timeline = appendTimelineFootnotes("timeline-hydrated");

    setRect(detail.body, { top: 100, height: 180 });
    setRect(detail.firstReference, { top: 110 });
    setRect(detail.secondReference, { top: 150 });
    setRect(detail.firstNote, { height: 20 });
    setRect(detail.secondNote, { height: 20 });
    setRect(timeline.body, { top: 500, height: 180 });
    setRect(timeline.firstReference, { top: 510 });
    setRect(timeline.secondReference, { top: 550 });
    setRect(timeline.firstNote, { height: 20 });
    setRect(timeline.secondNote, { height: 20 });

    initFootnoteRails(timeline.container);
    flushAnimationFrames();

    expect(__testOnly.getControllerCount()).toBe(1);
    expect(timeline.body.classList.contains("footnote-rail-ready")).toBe(true);
    expect(detail.body.classList.contains("footnote-rail-ready")).toBe(false);

    initFootnoteRails(document);
    flushAnimationFrames();
    expect(__testOnly.getControllerCount()).toBe(2);

    timeline.container.remove();
    initFootnoteRails(document);
    flushAnimationFrames();
    expect(__testOnly.getControllerCount()).toBe(1);
  });

  it("leaves excessive rails as bottom endnotes", () => {
    const { body, firstReference, secondReference, firstNote, secondNote } =
      renderCanonicalFootnotes();
    setRect(body, { top: 100, height: 40 });
    setRect(firstReference, { top: 105 });
    setRect(secondReference, { top: 110 });
    setRect(firstNote, { height: 240 });
    setRect(secondNote, { height: 240 });

    initFootnoteRails(document);
    flushAnimationFrames();

    expect(body.classList.contains("footnote-rail-ready")).toBe(false);
    expect(firstNote.style.getPropertyValue("--footnote-rail-y")).toBe("");
    expect(body.style.minBlockSize).toBe("");
  });

  it("keeps canonical bottom endnotes when the container is not wide enough", () => {
    const { body, firstReference, secondReference, firstNote, secondNote } =
      renderCanonicalFootnotes();
    vi.mocked(globalThis.getComputedStyle).mockImplementation(
      () =>
        ({
          getPropertyValue: () => "0",
          rowGap: "12px",
        }) as unknown as globalThis.CSSStyleDeclaration,
    );
    setRect(body, { top: 100, height: 200 });
    setRect(firstReference, { top: 110 });
    setRect(secondReference, { top: 160 });
    setRect(firstNote, { height: 20 });
    setRect(secondNote, { height: 20 });

    initFootnoteRails(document);
    flushAnimationFrames();

    expect(body.classList.contains("footnote-rail-ready")).toBe(false);
    expect(firstNote.style.getPropertyValue("--footnote-rail-y")).toBe("");
  });

  it("restores bottom endnotes for print and remeasures afterward", () => {
    const { body, firstReference, secondReference, firstNote, secondNote } =
      renderCanonicalFootnotes();
    setRect(body, { top: 100, height: 200 });
    setRect(firstReference, { top: 110 });
    setRect(secondReference, { top: 160 });
    setRect(firstNote, { height: 20 });
    setRect(secondNote, { height: 20 });
    initFootnoteRails(document);
    flushAnimationFrames();
    expect(body.classList.contains("footnote-rail-ready")).toBe(true);

    globalThis.dispatchEvent(new Event("beforeprint"));

    expect(body.classList.contains("footnote-rail-ready")).toBe(false);
    expect(body.style.minBlockSize).toBe("");

    globalThis.dispatchEvent(new Event("afterprint"));
    flushAnimationFrames();

    expect(body.classList.contains("footnote-rail-ready")).toBe(true);
  });

  it("repairs initial footnote hash position after enhancement", () => {
    const { body, firstReference, secondReference, firstNote, secondNote } =
      renderCanonicalFootnotes();
    globalThis.history.replaceState(null, "", "/post#fn-s-2");
    const scrollIntoView = vi.fn();
    secondNote.scrollIntoView = scrollIntoView;
    setRect(body, { top: 100, height: 200 });
    setRect(firstReference, { top: 110 });
    setRect(secondReference, { top: 160 });
    setRect(firstNote, { height: 20 });
    setRect(secondNote, { height: 20 });

    initFootnoteRails(document);
    flushAnimationFrames();

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "nearest",
    });
  });

  it("does not initialize rich text outside public post surfaces", () => {
    document.body.innerHTML = `
      <div class="compose-reply-context-body">
        <article data-post="pst_compose">
          <div class="prose post-body-summary" data-post-body>
            <p>Compose preview</p>
          </div>
        </article>
      </div>
    `;

    initFootnoteRails(document);
    flushAnimationFrames();

    expect(__testOnly.getControllerCount()).toBe(0);
  });
});
