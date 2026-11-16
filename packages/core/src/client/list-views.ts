/**
 * Counts the Threads a reader reads in full in a list.
 *
 * A list page — the home feed, a collection, Featured, the archive's list —
 * marks each item that shows a whole Thread with `data-view-unit`
 * (`lib/list-views.ts`), and its view token names the same Threads. This
 * script watches those items and, when the page is hidden (the reader leaves,
 * switches tabs, locks the phone), posts the token back followed by the
 * Threads read in full since the last report. The server counts each toward
 * its Thread (`routes/view-confirm.ts`).
 *
 * A Thread is read in full once all of these hold:
 *
 * - nothing of it is folded: no clamped note, no capped thread context;
 * - its top and its bottom have each been on screen, so all of it has passed
 *   through the screen;
 * - in a media strip too wide for its column, every item has been wholly
 *   inside the strip, or shown in the lightbox;
 * - it has been in front of the reader, with the page visible, as long as a
 *   fast reader takes to read it ({@link readingTimeMs}). In front is half
 *   of it on screen, or half the screen taken by it.
 *
 * A page load counts each Thread once. Following a link to one of a
 * Thread's posts leaves the Thread to the page it opens, which counts it
 * itself; a Thread already reported stays reported. Nothing is reported
 * before the page view itself is confirmed (`view-confirm.ts`), and nothing
 * about the reader is read or sent: the token and the Threads' ids are the
 * whole report.
 */

import {
  MEDIA_LIGHTBOX_SHOW_EVENT,
  type MediaLightboxShowDetail,
} from "./media-lightbox-events.js";
import { publicPath } from "./runtime-paths.js";
import { CONFIRM_PATH, deliver, isViewConfirmed } from "./view-confirm.js";

/** An average reader's pace in words a minute, for scripts that space words. */
export const LIST_VIEW_WORDS_PER_MINUTE = 250;

/** An average reader's pace in characters a minute, for Chinese, Japanese and Korean. */
export const LIST_VIEW_CJK_CHARACTERS_PER_MINUTE = 500;

/**
 * How much faster than average a reader may read and still count: the time
 * asked for is the average's share of this. A reader who reads every word
 * faster than this is missed; one who scrolls past is not counted.
 */
const FAST_READER_FACTOR = 2;

/** Added for each picture, video or attachment the Thread carries. */
const MEDIA_ITEM_MS = 1_000;

/** The least time a Thread must be in front of the reader. */
const MIN_READ_MS = 1_000;

/** How often the time in front is added up while a Thread is on screen. */
const TICK_MS = 500;

/** The most one tick may add: a machine waking from sleep adds nothing it slept. */
const MAX_TICK_MS = 1_000;

/** Rounding slack, in pixels, for an edge on the screen's edge. */
const EDGE_SLACK_PX = 2;

/** A thread context clipping less than this shows all of it (`thread-context.ts`). */
const CLIP_SLACK_PX = 8;

const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD = /[\p{L}\p{N}]/u;

/**
 * How long a Thread must be in front of the reader to count as read.
 *
 * @param text - The Thread's text
 * @param mediaItems - Pictures, videos and attachments it carries
 * @returns Milliseconds
 * @example
 * readingTimeMs("A short note with ten words in it, more or less.", 0); // 1200
 */
export function readingTimeMs(text: string, mediaItems: number): number {
  const characters = text.match(CJK)?.length ?? 0;
  const words = text
    .replace(CJK, " ")
    .split(/\s+/)
    .filter((word) => WORD.test(word)).length;
  const minutes =
    words / LIST_VIEW_WORDS_PER_MINUTE +
    characters / LIST_VIEW_CJK_CHARACTERS_PER_MINUTE;
  const ms =
    (minutes * 60_000) / FAST_READER_FACTOR + mediaItems * MEDIA_ITEM_MS;
  return Math.max(MIN_READ_MS, Math.round(ms));
}

interface Unit {
  id: string;
  element: HTMLElement;
  requiredMs: number;
  visibleMs: number;
  topSeen: boolean;
  /** The height the bottom was on screen at; `null` until then, or once the Thread grew. */
  bottomSeenAt: number | null;
  /** `left`: the reader followed a link to it, and its page counts it. */
  state: "reading" | "read" | "sent" | "left";
}

/** What a page's tracker exposes; the page itself needs none of it. */
export interface ListViewTracker {
  /** Measure now: what is on screen, and for how long it has been. */
  check(): void;
  /** Send what has been read and not yet sent. */
  report(): void;
  /** The Threads read in full and not yet sent. */
  pending(): string[];
  /** Stop watching: no more measuring, no more reports. */
  stop(): void;
}

/**
 * Watch the page's whole Threads, if the page has any and a token to report
 * them with.
 *
 * @param doc - The document, the current one unless a test passes another
 * @param options.now - Clock in milliseconds, for tests
 * @param options.confirmed - Whether the page view is confirmed, for tests
 * @returns The tracker, or `null` when there is nothing to watch
 * @example
 * trackListViews();
 */
export function trackListViews(
  doc: globalThis.Document = document,
  options: {
    now?: () => number;
    confirmed?: () => boolean;
  } = {},
): ListViewTracker | null {
  const token = doc
    .querySelector<globalThis.HTMLMetaElement>('meta[name="jant-view"]')
    ?.getAttribute("content");
  if (!token) return null;
  if (navigator.webdriver) return null;
  const now = options.now ?? Date.now;
  const confirmed = options.confirmed ?? (() => isViewConfirmed(doc));
  const view = doc.defaultView ?? window;

  const units: Unit[] = [];
  const byPath = new Map<string, Unit>();
  for (const element of doc.querySelectorAll<HTMLElement>("[data-view-unit]")) {
    const id = element.dataset.viewUnit;
    if (!id || units.some((unit) => unit.id === id)) continue;
    const media =
      element.querySelectorAll("[data-media-gallery] > *").length +
      element.querySelectorAll("[data-post-body] img").length;
    const unit: Unit = {
      id,
      element,
      requiredMs: readingTimeMs(element.textContent ?? "", media),
      visibleMs: 0,
      topSeen: false,
      bottomSeenAt: null,
      state: "reading",
    };
    units.push(unit);
    for (const article of element.querySelectorAll<HTMLElement>(
      "article[data-post-permalink]",
    )) {
      const path = pathOf(article.dataset.postPermalink, doc);
      if (path) byPath.set(path, unit);
    }
  }
  if (units.length === 0) return null;

  /** Strip items that have been wholly in view, in their strip or the lightbox. */
  const seenItems = new WeakSet<globalThis.Element>();

  const isFolded = (unit: Unit): boolean =>
    unit.element.querySelector("[data-note-clamp]") !== null ||
    [
      ...unit.element.querySelectorAll<HTMLElement>("[data-thread-context]"),
    ].some((shell) => shell.scrollHeight > shell.clientHeight + CLIP_SLACK_PX);

  const strips = (unit: Unit): HTMLElement[] =>
    [
      ...unit.element.querySelectorAll<HTMLElement>("[data-media-gallery]"),
    ].filter((strip) => strip.scrollWidth > strip.clientWidth + 1);

  const markStripItems = (unit: Unit, viewportHeight: number): void => {
    for (const strip of strips(unit)) {
      const box = strip.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= viewportHeight) continue;
      for (const item of strip.children) {
        const rect = item.getBoundingClientRect();
        if (
          rect.left >= box.left - EDGE_SLACK_PX &&
          rect.right <= box.right + EDGE_SLACK_PX
        ) {
          seenItems.add(item);
        }
      }
    }
  };

  const isRead = (unit: Unit): boolean =>
    unit.topSeen &&
    unit.bottomSeenAt !== null &&
    unit.visibleMs >= unit.requiredMs &&
    !isFolded(unit) &&
    strips(unit).every((strip) =>
      [...strip.children].every((item) => seenItems.has(item)),
    );

  let lastMeasured: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** Update every Thread still being read; whether any is on screen. */
  const measure = (): boolean => {
    const at = now();
    const elapsed =
      lastMeasured === null ? 0 : Math.min(at - lastMeasured, MAX_TICK_MS);
    lastMeasured = at;
    const viewportHeight = view.innerHeight;
    const visible = doc.visibilityState === "visible";
    let onScreen = false;

    for (const unit of units) {
      if (unit.state !== "reading") continue;
      const rect = unit.element.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= viewportHeight) continue;
      onScreen = true;

      const onEdge = (y: number) =>
        y >= -EDGE_SLACK_PX && y <= viewportHeight + EDGE_SLACK_PX;
      if (onEdge(rect.top)) unit.topSeen = true;
      // Unfolding grows the Thread downward: its new bottom has to be seen.
      if (
        unit.bottomSeenAt !== null &&
        rect.height > unit.bottomSeenAt + EDGE_SLACK_PX
      ) {
        unit.bottomSeenAt = null;
      }
      if (onEdge(rect.bottom)) unit.bottomSeenAt = rect.height;
      markStripItems(unit, viewportHeight);

      const shown =
        Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
      if (visible && shown >= Math.min(rect.height, viewportHeight) / 2) {
        unit.visibleMs += elapsed;
      }
      if (isRead(unit)) unit.state = "read";
    }
    return onScreen;
  };

  const stopTimer = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    lastMeasured = null;
  };

  const check = (): void => {
    const onScreen = measure();
    const reading = units.some((unit) => unit.state === "reading");
    if (!onScreen || !reading || doc.visibilityState !== "visible") {
      stopTimer();
      return;
    }
    if (timer === null) timer = setInterval(check, TICK_MS);
  };

  const pending = (): string[] =>
    units.filter((unit) => unit.state === "read").map((unit) => unit.id);

  const report = (): void => {
    if (!confirmed()) return;
    const read = units.filter((unit) => unit.state === "read");
    if (read.length === 0) return;
    for (const unit of read) unit.state = "sent";
    deliver(
      publicPath(CONFIRM_PATH),
      `${token}\n${read.map((unit) => unit.id).join(" ")}`,
    );
  };

  let frame = 0;
  const schedule = (): void => {
    if (frame !== 0) return;
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      check();
    });
  };

  // A link to one of a Thread's posts opens the page that counts it.
  const onFollow = (event: MouseEvent): void => {
    if (event.type === "click" ? event.defaultPrevented : event.button !== 1) {
      return;
    }
    const target = event.target;
    if (!(target instanceof view.Element)) return;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    const path = link ? pathOf(link.getAttribute("href"), doc) : null;
    const unit = path ? byPath.get(path) : undefined;
    if (unit && (unit.state === "reading" || unit.state === "read")) {
      unit.state = "left";
    }
  };

  const onLightbox = (event: Event): void => {
    const { source, index } = (event as CustomEvent<MediaLightboxShowDetail>)
      .detail;
    const link = source?.querySelector(`[data-lightbox-index="${index}"]`);
    // The strip's item is the child holding the link; a short video wraps it.
    const item = link
      ? [...(source?.children ?? [])].find((child) => child.contains(link))
      : undefined;
    if (item) seenItems.add(item);
    schedule();
  };

  const listening = new AbortController();
  const { signal } = listening;
  doc.addEventListener("scroll", schedule, {
    capture: true,
    passive: true,
    signal,
  });
  view.addEventListener("resize", schedule, { passive: true, signal });
  doc.addEventListener("click", schedule, { signal });
  doc.addEventListener(MEDIA_LIGHTBOX_SHOW_EVENT, onLightbox, { signal });
  // On the window, after the document's own handlers: a click they turned
  // into an in-place action (expanding a note) has its default prevented.
  view.addEventListener("click", onFollow, { signal });
  view.addEventListener("auxclick", onFollow, { signal });
  doc.addEventListener(
    "visibilitychange",
    () => {
      if (doc.visibilityState === "visible") {
        check();
        return;
      }
      measure();
      stopTimer();
      report();
    },
    { signal },
  );
  view.addEventListener("pagehide", report, { signal });
  view.addEventListener("pageshow", check, { signal });
  check();

  const stop = (): void => {
    listening.abort();
    stopTimer();
    if (frame !== 0) view.cancelAnimationFrame(frame);
    frame = 0;
  };

  return { check, report, pending, stop };
}

/** A same-site address's path, or `null` for any other address. */
function pathOf(
  href: string | null | undefined,
  doc: globalThis.Document,
): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, doc.baseURI);
    return url.origin === new URL(doc.baseURI).origin ? url.pathname : null;
  } catch {
    return null;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => trackListViews(), {
    once: true,
  });
} else {
  trackListViews();
}
