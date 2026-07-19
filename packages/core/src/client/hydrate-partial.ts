/**
 * Re-initialize interactive behaviors inside a server-rendered fragment that
 * was swapped into the DOM after page load — e.g. compose-bridge replacing a
 * timeline item or post view after a reply or edit.
 *
 * Most interactions survive a swap on their own: note-expand and the audio
 * transport use document-level event delegation, and media-scroll-hint runs its
 * own MutationObserver. The ones gathered here need per-element setup
 * (IntersectionObserver / ResizeObserver / canvas drawing) that otherwise only
 * runs once on DOMContentLoaded, so a freshly swapped fragment would stay inert
 * until a full reload. Each initializer is idempotent, so calling this on a root
 * that already contains initialized nodes is safe.
 */

import { setupThreadContexts } from "./thread-context.js";
import { initFeedVideoPlayer } from "./feed-video-player.js";
import { initPrecomputedWaveforms } from "./audio-player.js";
import { initFootnoteRails } from "./footnote-rail.js";

export function hydratePartial(
  root: globalThis.Document | globalThis.Element,
): void {
  setupThreadContexts(root);
  initFeedVideoPlayer(root);
  initPrecomputedWaveforms(root);
  initFootnoteRails(root);
}
