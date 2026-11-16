// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readingTimeMs,
  trackListViews,
  type ListViewTracker,
} from "../list-views.js";
import { MEDIA_LIGHTBOX_SHOW_EVENT } from "../media-lightbox-events.js";

const TOKEN = "payload.0123456789abcdef0123456789abcdef";
const NOTE = "pst_01h455vb4pex5vsknk084sn02q";
const VIEWPORT = 800;

interface Box {
  top: number;
  height: number;
  left?: number;
  width?: number;
}

/** Give an element a layout box; returns a setter to move it. */
function place(element: globalThis.Element, box: Box): (next: Box) => void {
  let current = box;
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
    const left = current.left ?? 0;
    const width = current.width ?? 600;
    return {
      top: current.top,
      bottom: current.top + current.height,
      height: current.height,
      left,
      right: left + width,
      width,
      x: left,
      y: current.top,
      toJSON: () => ({}),
    } as globalThis.DOMRect;
  });
  return (next) => {
    current = next;
  };
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A list page with one whole Thread holding `body`. */
function page(body = "<p>A short note.</p>"): HTMLElement {
  document.head.innerHTML = `<meta name="jant-view" content="${TOKEN}">`;
  document.body.innerHTML = `
    <div class="feed-item" data-view-unit="${NOTE}">
      <article data-post data-post-permalink="/note">
        <div data-post-body>${body}</div>
        <a class="u-url" href="/note">Nov 16</a>
      </article>
    </div>`;
  return document.querySelector("[data-view-unit]") as HTMLElement;
}

async function sentBodies(beacon: ReturnType<typeof vi.fn>): Promise<string[]> {
  return Promise.all(beacon.mock.calls.map((call) => (call[1] as Blob).text()));
}

describe("readingTimeMs", () => {
  it("asks half an average reader's time, a second per media item, a second at least", () => {
    // 250 words: a minute at the average pace, half of it here.
    expect(readingTimeMs("word ".repeat(250), 0)).toBe(30_000);
    // 500 CJK characters: the same minute.
    expect(readingTimeMs("字".repeat(500), 0)).toBe(30_000);
    expect(readingTimeMs("", 3)).toBe(3_000);
    expect(readingTimeMs("", 0)).toBe(1_000);
  });
});

describe("trackListViews", () => {
  let beacon: ReturnType<typeof vi.fn>;
  let clock: number;
  let confirmed: boolean;
  let trackers: ListViewTracker[];

  function track(): ListViewTracker {
    const tracker = trackListViews(document, {
      now: () => clock,
      confirmed: () => confirmed,
    });
    expect(tracker).not.toBeNull();
    trackers.push(tracker as ListViewTracker);
    return tracker as ListViewTracker;
  }

  /** Let `ms` pass with the page as it is, measured as the timer would. */
  function wait(tracker: ListViewTracker, ms: number): void {
    tracker.check();
    for (let passed = 0; passed < ms; passed += 500) {
      clock += Math.min(500, ms - passed);
      tracker.check();
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    trackers = [];
    clock = 0;
    confirmed = true;
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "webdriver", {
      value: false,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: VIEWPORT,
      configurable: true,
    });
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  afterEach(() => {
    for (const tracker of trackers) tracker.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("watches nothing on a page without a token or a whole Thread", () => {
    page();
    document.head.innerHTML = "";
    expect(trackListViews(document)).toBeNull();
    document.head.innerHTML = `<meta name="jant-view" content="${TOKEN}">`;
    document.body.innerHTML = "<main></main>";
    expect(trackListViews(document)).toBeNull();
  });

  it("reports a Thread read in full once the page is hidden, and only once", async () => {
    place(page(), { top: 100, height: 200 });
    const tracker = track();

    wait(tracker, 999);
    expect(tracker.pending()).toEqual([]);
    wait(tracker, 1);
    expect(tracker.pending()).toEqual([NOTE]);

    setVisibility("hidden");
    expect(await sentBodies(beacon)).toEqual([`${TOKEN}\n${NOTE}`]);
    expect(beacon.mock.calls[0]?.[0]).toBe("/_/seen");

    setVisibility("visible");
    wait(tracker, 5_000);
    setVisibility("hidden");
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("asks for the time its words take", () => {
    // 250 words and the date's two: a little over 30 seconds.
    place(page(`<p>${"word ".repeat(250)}</p>`), { top: 100, height: 600 });
    const tracker = track();
    wait(tracker, 30_000);
    expect(tracker.pending()).toEqual([]);
    wait(tracker, 1_000);
    expect(tracker.pending()).toEqual([NOTE]);
  });

  it("needs its top and its bottom on screen", () => {
    const move = place(page(), { top: 100, height: 2_000 });
    const tracker = track();
    wait(tracker, 10_000);
    expect(tracker.pending()).toEqual([]);

    move({ top: -1_500, height: 2_000 });
    wait(tracker, 1);
    expect(tracker.pending()).toEqual([NOTE]);
  });

  it("adds no time while it barely shows or the page is hidden", () => {
    const move = place(page(), { top: VIEWPORT - 50, height: 200 });
    const tracker = track();
    wait(tracker, 10_000);

    move({ top: 100, height: 200 });
    setVisibility("hidden");
    clock += 10_000;
    tracker.check();
    expect(tracker.pending()).toEqual([]);

    setVisibility("visible");
    wait(tracker, 1_000);
    expect(tracker.pending()).toEqual([NOTE]);
  });

  it("waits for a clamped note to be unfolded, then for its new bottom", () => {
    const unit = page('<div data-note-clamp=""><p>Long note</p></div>');
    const move = place(unit, { top: 100, height: 200 });
    const tracker = track();
    wait(tracker, 5_000);
    expect(tracker.pending()).toEqual([]);

    unit.querySelector("[data-note-clamp]")?.removeAttribute("data-note-clamp");
    move({ top: 100, height: 1_500 });
    wait(tracker, 1_000);
    expect(tracker.pending()).toEqual([]);

    move({ top: -900, height: 1_500 });
    wait(tracker, 1);
    expect(tracker.pending()).toEqual([NOTE]);
  });

  it("waits for a capped thread context to be expanded", () => {
    const unit = page();
    const shell = document.createElement("div");
    shell.setAttribute("data-thread-context", "");
    Object.defineProperty(shell, "scrollHeight", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(shell, "clientHeight", {
      value: 160,
      configurable: true,
    });
    unit.insertBefore(shell, unit.firstChild);
    place(unit, { top: 100, height: 300 });
    const tracker = track();
    wait(tracker, 5_000);
    expect(tracker.pending()).toEqual([]);

    Object.defineProperty(shell, "clientHeight", {
      value: 400,
      configurable: true,
    });
    wait(tracker, 1);
    expect(tracker.pending()).toEqual([NOTE]);
  });

  it("needs every item of a media strip that scrolls sideways, in the strip or the lightbox", () => {
    const unit = page(
      `<p>Photos</p></div><div data-media-gallery data-lightbox-group="[]">` +
        `<a data-lightbox-index="0" href="/a.jpg"></a>` +
        `<a data-lightbox-index="1" href="/b.jpg"></a>` +
        // A short video wraps its link.
        `<div><a data-lightbox-index="2" href="/c.mp4"></a></div>`,
    );
    place(unit, { top: 100, height: 500 });
    const strip = unit.querySelector("[data-media-gallery]") as HTMLElement;
    Object.defineProperty(strip, "scrollWidth", {
      value: 900,
      configurable: true,
    });
    Object.defineProperty(strip, "clientWidth", {
      value: 600,
      configurable: true,
    });
    place(strip, { top: 300, height: 200, left: 0, width: 600 });
    const [first, second, third] = [...strip.children];
    place(first as globalThis.Element, {
      top: 300,
      height: 200,
      left: 0,
      width: 280,
    });
    place(second as globalThis.Element, {
      top: 300,
      height: 200,
      left: 290,
      width: 280,
    });
    place(third as globalThis.Element, {
      top: 300,
      height: 200,
      left: 580,
      width: 280,
    });
    const tracker = track();
    wait(tracker, 10_000);
    expect(tracker.pending()).toEqual([]);

    document.dispatchEvent(
      new CustomEvent(MEDIA_LIGHTBOX_SHOW_EVENT, {
        detail: { source: strip, index: 2 },
      }),
    );
    wait(tracker, 1);
    expect(tracker.pending()).toEqual([NOTE]);
  });

  it("leaves a Thread to its page once the reader follows a link to it", () => {
    const unit = page();
    place(unit, { top: 100, height: 200 });
    const tracker = track();
    wait(tracker, 5_000);
    expect(tracker.pending()).toEqual([NOTE]);

    unit
      .querySelector("a.u-url")
      ?.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(tracker.pending()).toEqual([]);
    setVisibility("hidden");
    expect(beacon).not.toHaveBeenCalled();
  });

  it("ignores a click another script turned into an action in place", () => {
    const unit = page();
    place(unit, { top: 100, height: 200 });
    const tracker = track();
    wait(tracker, 5_000);

    const link = unit.querySelector("a.u-url") as HTMLAnchorElement;
    const prevent = (event: Event) => event.preventDefault();
    document.addEventListener("click", prevent);
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    document.removeEventListener("click", prevent);
    expect(tracker.pending()).toEqual([NOTE]);
  });

  it("holds its report until the page view is confirmed", async () => {
    confirmed = false;
    place(page(), { top: 100, height: 200 });
    const tracker = track();
    wait(tracker, 5_000);

    setVisibility("hidden");
    expect(beacon).not.toHaveBeenCalled();

    confirmed = true;
    setVisibility("visible");
    setVisibility("hidden");
    expect(await sentBodies(beacon)).toEqual([`${TOKEN}\n${NOTE}`]);
  });
});
