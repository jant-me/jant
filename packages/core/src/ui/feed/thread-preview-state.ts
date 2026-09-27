import type { PostView } from "../../types.js";

/**
 * A lone root post shorter than this (plain-text code points) comfortably
 * fits the thread-context height cap. Pairs with the
 * `--site-thread-context-max-height` token (160px) in tokens.css — revisit
 * both together if that cap changes.
 */
const SHORT_ROOT_CHAR_LIMIT = 120;

/**
 * First-paint guess for whether the thread-context shell will overflow its
 * height cap, used to pick the initial "Show more" toggle visibility.
 *
 * The client (thread-context.ts) always re-measures and corrects this, so a
 * wrong guess costs at most a one-time flash on load — never a wrong final
 * state. Kept deliberately coarse:
 *
 * - 3+ post threads stack 2+ cards in the shell — effectively always overflow.
 * - A lone root carrying media is tall regardless of its text length.
 * - Otherwise fall back to a plain-text length threshold. Only clearly short
 *   roots flip to "fits"; anything at or above the limit keeps the historical
 *   "assume overflow" default, so this can only remove flashes, never add them.
 *
 * @param rootPost - the thread's root post (the only post in a 2-post thread's
 *   shell)
 * @param totalReplyCount - replies in the thread; `>= 2` means 3+ posts total
 * @returns whether to render the toggle visible on first paint
 */
export function threadContextAssumesOverflow({
  rootPost,
  totalReplyCount,
}: {
  rootPost: PostView;
  totalReplyCount: number;
}): boolean {
  if (totalReplyCount >= 2) return true;
  if (rootPost.media.length > 0 || Boolean(rootPost.previewImageUrl)) {
    return true;
  }
  // `summary` is format-normalized at the viewmodel layer: quote text for
  // quotes, body text for notes, the URL for bare links.
  return [...(rootPost.summary ?? "")].length >= SHORT_ROOT_CHAR_LIMIT;
}
