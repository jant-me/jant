/**
 * Opens the "Share as image" dialog from the post menu.
 *
 * The dialog and snapdom ship in their own bundle. The post menu starts
 * loading it when it opens; picking the item asks the server for the card at
 * the same time as it waits for the bundle, and only then talks to the
 * element.
 */

import type { JantShareDialog } from "./components/jant-share-dialog.js";
import { ensureShare } from "./lazy-entries.js";
import { publicPath } from "./runtime-paths.js";
import { showToast } from "./toast.js";

async function fetchShareCard(postId: string): Promise<string> {
  const response = await fetch(
    publicPath(`/_/share-card/${encodeURIComponent(postId)}`),
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/**
 * Start loading the share bundle, so the dialog opens without waiting for
 * it. Out of the way of the menu's first frame; a failure is left for
 * {@link openShareImage} to report.
 */
export function warmShareImage(): void {
  setTimeout(() => {
    ensureShare().catch(() => {});
  }, 0);
}

/**
 * Show the share dialog for a post.
 *
 * @param postId - TypeID of the post to share
 * @param returnFocus - Element to focus again when the dialog closes
 */
export async function openShareImage(
  postId: string,
  returnFocus?: HTMLElement | null,
): Promise<void> {
  // The first card is asked for now, alongside the bundle; "Try again" in
  // the dialog asks again.
  let first: Promise<string> | null = fetchShareCard(postId);
  first.catch(() => {});
  const loadCard = () => {
    const card = first ?? fetchShareCard(postId);
    first = null;
    return card;
  };

  try {
    await ensureShare();
  } catch {
    showToast(
      "Could not open sharing. Check your connection and try again.",
      "error",
    );
    return;
  }
  let dialog = document.querySelector<JantShareDialog>("jant-share-dialog");
  if (!dialog) {
    dialog = document.createElement("jant-share-dialog") as JantShareDialog;
    document.body.appendChild(dialog);
  }
  await dialog.open(loadCard, returnFocus ?? null);
}
