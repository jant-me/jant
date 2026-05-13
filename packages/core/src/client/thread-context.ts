/**
 * Thread Context Interactions
 *
 * Auto-scroll to current post on thread detail pages.
 */

function isFirstThreadDetailItem(current: HTMLElement): boolean {
  const group = current.closest<HTMLElement>(".thread-group-detail");
  if (!group) return false;

  const firstItem = group.querySelector<HTMLElement>(".thread-detail-item");
  return firstItem === current;
}

function isContinueHash(): boolean {
  return globalThis.location.hash === "#continue";
}

function scrollCurrentDetailPostIntoView(
  root: globalThis.Document | globalThis.Element = document,
): void {
  const current = root.querySelector("[data-post-current]");
  if (!(current instanceof HTMLElement)) return;

  const continueHash = isContinueHash();

  // Explicit hashes still win, except for #continue on thread detail pages.
  if (globalThis.location.hash && !continueHash) return;

  const scrollBehavior = continueHash ? "auto" : "smooth";
  const isFirstItem = isFirstThreadDetailItem(current);

  requestAnimationFrame(() => {
    // Root posts should stay at the top, but #continue deep-links need to be
    // reset because permalink thread pages should open at the current post start.
    if (isFirstItem && !continueHash) return;

    current.scrollIntoView({ behavior: scrollBehavior, block: "start" });
  });
}

// Auto-scroll to current post on detail pages
document.addEventListener("DOMContentLoaded", () => {
  scrollCurrentDetailPostIntoView(document);
});

export const __testOnly = {
  isFirstThreadDetailItem,
  scrollCurrentDetailPostIntoView,
};
