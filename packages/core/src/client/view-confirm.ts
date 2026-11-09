/**
 * Tells the site that this page was seen.
 *
 * The server embeds a signed token in a page it would count as a view
 * (`<meta name="jant-view">`, see `lib/view-token.ts`). It counts the view
 * only once this script posts the token back, which it does once the page
 * has been in front of the reader for five seconds in total, or sooner, on
 * the first scroll, tap, key or pointer movement. A crawler that runs a real
 * browser closes the page long before either, and an automated browser that
 * admits to it (`navigator.webdriver`) is not asked at all.
 *
 * The token names the page and where the reader came from, decided on the
 * server from the request; nothing about the reader is read here or sent.
 * No cookie, no storage, one request, and nothing waits for its answer.
 */

import { publicPath } from "./runtime-paths.js";

/** Visible time after which a page counts as seen, without any interaction. */
export const VIEW_CONFIRM_DWELL_MS = 5_000;

/** Where the token goes; the same path `lib/view-token.ts` names. */
const CONFIRM_PATH = "/_/seen";

/** Anything a reader does that a crawler fetching a page does not. */
const INTERACTION_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

function deliver(url: string, token: string): void {
  const sent =
    typeof navigator.sendBeacon === "function" &&
    navigator.sendBeacon(url, new Blob([token], { type: "text/plain" }));
  if (sent) return;
  void fetch(url, {
    method: "POST",
    body: token,
    keepalive: true,
    headers: { "content-type": "text/plain" },
  }).catch(() => {});
}

/**
 * Arm the page's confirmation, if the page carries a token.
 *
 * @param doc - The document, the current one unless a test passes another
 * @returns Nothing
 * @example
 * confirmView();
 */
export function confirmView(doc: globalThis.Document = document): void {
  const token = doc
    .querySelector<globalThis.HTMLMetaElement>('meta[name="jant-view"]')
    ?.getAttribute("content");
  if (!token) return;
  if (navigator.webdriver) return;

  const url = publicPath(CONFIRM_PATH);
  let done = false;
  let remaining = VIEW_CONFIRM_DWELL_MS;
  let visibleSince: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stopClock = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    remaining = Math.max(0, remaining - (Date.now() - (visibleSince ?? 0)));
  };
  const startClock = () => {
    if (done || timer !== null || doc.visibilityState !== "visible") return;
    visibleSince = Date.now();
    timer = setTimeout(send, remaining);
  };
  const onVisibility = () => {
    if (doc.visibilityState === "visible") startClock();
    else stopClock();
  };
  const send = () => {
    if (done) return;
    done = true;
    stopClock();
    for (const event of INTERACTION_EVENTS) {
      doc.removeEventListener(event, send);
    }
    doc.removeEventListener("visibilitychange", onVisibility);
    deliver(url, token);
  };

  for (const event of INTERACTION_EVENTS) {
    doc.addEventListener(event, send, { passive: true });
  }
  doc.addEventListener("visibilitychange", onVisibility);
  startClock();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => confirmView(), {
    once: true,
  });
} else {
  confirmView();
}
