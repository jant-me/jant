/**
 * Opens the "Share as image" dialog from a post menu, the author's or a
 * reader's.
 *
 * The dialog and snapdom ship in their own bundle, and their styles in their
 * own stylesheet. The menu starts loading both when it opens; picking the
 * item asks the server for the card at the same time as it waits for them,
 * and only then talks to the element.
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

let styles: Promise<void> | undefined;

/**
 * Link the share stylesheet, which `<html data-share-stylesheet>` names, and
 * resolve once it has loaded. A load that fails is forgotten, so the next
 * call links it again.
 */
function ensureShareStyles(): Promise<void> {
  return (styles ??= new Promise<void>((resolve, reject) => {
    const href = document.documentElement.dataset.shareStylesheet;
    if (!href) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener(
      "error",
      () => {
        link.remove();
        styles = undefined;
        reject(new Error(`Could not load ${href}`));
      },
      { once: true },
    );
    document.head.appendChild(link);
  }));
}

/** Wait for the bundle and the stylesheet, and return what failed. */
async function settleShareLoads(): Promise<unknown[]> {
  const results = await Promise.allSettled([
    ensureShare(),
    ensureShareStyles(),
  ]);
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
}

/**
 * Load the share bundle and its styles, trying once more what fails: a
 * dropped request is the usual cause, and both loads forget a failure. Both
 * settle before the retry, so neither is still on its first try.
 *
 * @returns Whether both loaded
 */
async function loadShare(): Promise<boolean> {
  let failures = await settleShareLoads();
  if (failures.length > 0) {
    // eslint-disable-next-line no-console -- the toast names no cause; the console keeps it
    console.warn("[jant] share: loading failed, trying again", ...failures);
    failures = await settleShareLoads();
  }
  if (failures.length > 0) {
    // eslint-disable-next-line no-console -- the toast names no cause; the console keeps it
    console.error("[jant] share: could not load", ...failures);
    return false;
  }
  return true;
}

/**
 * Start loading the share bundle and its styles, so the dialog opens without
 * waiting for them. Out of the way of the menu's first frame; a failure is
 * left for {@link openShareImage} to retry and report.
 */
export function warmShareImage(): void {
  setTimeout(() => {
    ensureShare().catch(() => {});
    ensureShareStyles().catch(() => {});
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

  if (!(await loadShare())) {
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
