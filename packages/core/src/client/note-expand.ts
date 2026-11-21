/**
 * Expand-in-place for truncated untitled notes and link commentary.
 *
 * The card renders the full body with a zero-width `data-note-break`
 * marker at the summary boundary; CSS (`[data-note-clamp] [data-note-break] ~
 * *`) hides everything after it until expanded. The "Read more" control (an
 * `<a>` to the permalink, which is the no-JS fallback) toggles the clamp.
 *
 * Because the tail is already laid out below the visible summary, revealing it
 * inserts content below the browser's scroll anchor — so the note grows in
 * place without the page jumping. Collapsing pulls the note top back into view
 * when the reader had scrolled into the now-hidden tail.
 *
 * Document-level click delegation keeps this working after compose-bridge
 * replaces card DOM on edit/reply — per-element listeners would be orphaned.
 */

/** True for clicks that should keep their native behavior (open in new tab, etc.). */
function isModifiedClick(e: MouseEvent): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

function setLabel(control: HTMLElement, label: string | undefined): void {
  if (label) control.textContent = label;
}

function handleClick(e: MouseEvent): void {
  const target = e.target;
  if (!(target instanceof globalThis.Element)) return;

  const control = target.closest<HTMLAnchorElement>("a[data-note-expand]");
  if (!control || isModifiedClick(e)) return;

  // Scope the body to this card — other cards on the page use the same
  // [data-post-body] attribute. With no clampable body (server fell back to a
  // full render), let the link navigate to the permalink as the fallback.
  const article = control.closest<HTMLElement>("article[data-post]");
  const body = article?.querySelector<HTMLElement>("[data-post-body]");
  if (!article || !body || !body.querySelector("[data-note-break]")) return;

  e.preventDefault();

  if (body.hasAttribute("data-note-clamp")) {
    body.removeAttribute("data-note-clamp");
    control.setAttribute("aria-expanded", "true");
    setLabel(control, control.dataset.labelLess);
    return;
  }

  body.setAttribute("data-note-clamp", "");
  control.setAttribute("aria-expanded", "false");
  setLabel(control, control.dataset.labelMore);
  // Re-clamping shrinks content above the control; if the reader had scrolled
  // into the tail, bring the note top back into view.
  if (
    article.getBoundingClientRect().top < 0 &&
    typeof article.scrollIntoView === "function"
  ) {
    article.scrollIntoView({ block: "start" });
  }
}

document.addEventListener("click", handleClick);
