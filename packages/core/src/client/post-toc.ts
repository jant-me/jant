const TOC_SELECTOR = "[data-post-toc]";
const TRIGGER_SELECTOR = "[data-post-toc-trigger]";
const LINK_SELECTOR = "[data-post-toc-link]";

let listening = false;
let frame: number | undefined;

function setOpen(toc: HTMLElement, open: boolean): void {
  toc.toggleAttribute("data-open", open);
  toc
    .querySelector(TRIGGER_SELECTOR)
    ?.setAttribute("aria-expanded", String(open));
}

function scheduleCurrentSection(): void {
  if (frame !== undefined) return;
  frame = globalThis.requestAnimationFrame(() => {
    frame = undefined;
    const toc = document.querySelector<HTMLElement>(TOC_SELECTOR);
    if (!toc) return;
    const links = [...toc.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR)];
    const scrolling = document.scrollingElement;
    const atEnd =
      scrolling &&
      scrolling.scrollTop > 0 &&
      scrolling.scrollTop + scrolling.clientHeight >=
        scrolling.scrollHeight - 1;
    let current: HTMLAnchorElement | undefined;
    for (const link of links) {
      const heading = document.getElementById(link.dataset.postTocLink ?? "");
      if (!heading) continue;
      const offset = Number.parseFloat(
        getComputedStyle(heading).scrollMarginBlockStart,
      );
      const line = atEnd ? globalThis.innerHeight : (offset || 0) + 1;
      if (heading.getBoundingClientRect().top > line) break;
      current = link;
    }
    const previous = toc.querySelector('[aria-current="location"]');
    if (previous !== current) {
      previous?.removeAttribute("aria-current");
      current?.setAttribute("aria-current", "location");
    }
  });
}

/**
 * Enable the narrow-screen section menu and track the reader's current section.
 *
 * @param root - The document or newly inserted post view
 * @returns Nothing
 * @example
 * initPostToc(document);
 */
export function initPostToc(
  root: globalThis.Document | globalThis.Element,
): void {
  const toc = root.querySelector<HTMLElement>(TOC_SELECTOR);
  if (!toc) return;
  toc.setAttribute("data-ready", "");
  scheduleCurrentSection();
  if (listening) return;
  listening = true;

  document.addEventListener("click", (event) => {
    const activeToc = document.querySelector<HTMLElement>(TOC_SELECTOR);
    if (!activeToc || !(event.target instanceof globalThis.Element)) return;

    const button = event.target.closest(TRIGGER_SELECTOR);
    if (button && activeToc.contains(button)) {
      const open = !activeToc.hasAttribute("data-open");
      if (open) {
        document.dispatchEvent(
          new CustomEvent("basecoat:popover", {
            detail: { source: activeToc },
          }),
        );
      }
      setOpen(activeToc, open);
      return;
    }

    const link = event.target.closest<HTMLAnchorElement>(LINK_SELECTOR);
    if (link && activeToc.contains(link)) {
      if (
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const heading = document.getElementById(link.dataset.postTocLink ?? "");
      if (!heading) return;
      event.preventDefault();
      setOpen(activeToc, false);
      if (globalThis.location.hash !== link.hash) {
        globalThis.history.pushState(null, "", link.hash);
      }
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: "start" });
      scheduleCurrentSection();
    } else if (!activeToc.contains(event.target)) {
      setOpen(activeToc, false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const openToc = document.querySelector<HTMLElement>(
      `${TOC_SELECTOR}[data-open]`,
    );
    if (!openToc) return;
    const hadFocus = openToc.contains(document.activeElement);
    setOpen(openToc, false);
    if (hadFocus) {
      event.preventDefault();
      openToc.querySelector<HTMLButtonElement>(TRIGGER_SELECTOR)?.focus();
    }
  });

  document.addEventListener("basecoat:popover", (event) => {
    const openToc = document.querySelector<HTMLElement>(
      `${TOC_SELECTOR}[data-open]`,
    );
    if (
      openToc &&
      (event as CustomEvent<{ source?: globalThis.Element }>).detail?.source !==
        openToc
    ) {
      setOpen(openToc, false);
    }
  });

  globalThis.addEventListener("scroll", scheduleCurrentSection, {
    passive: true,
  });
  globalThis.addEventListener("resize", scheduleCurrentSection);
  globalThis.addEventListener("hashchange", scheduleCurrentSection);
}

if (typeof document !== "undefined") {
  initPostToc(document);
}
