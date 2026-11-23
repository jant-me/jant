const TOC_SELECTOR = "[data-post-toc]";
const TRIGGER_SELECTOR = "[data-post-toc-trigger]";
const PANEL_SELECTOR = "[data-post-toc-panel]";
const LINK_SELECTOR = "[data-post-toc-link]";
const TICK_SELECTOR = "[data-post-toc-tick]";
const HEADING_ANCHOR_SELECTOR = "[data-heading-anchor]";

const DESKTOP_HOVER_QUERY = "(max-width: 1024px), (hover: none)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MIN_BODY_VIEWPORT_RATIO = 1.6;
const MIN_SCROLL_VIEWPORT_RATIO = 2.0;
const HOVER_CLOSE_DELAY_MS = 180;
const COPIED_RESET_MS = 1600;

let listening = false;
let frame: number | undefined;
let observedBody: HTMLElement | null = null;
let bodyResizeObserver: globalThis.ResizeObserver | null = null;

const boundTocs = new WeakSet<HTMLElement>();
const hoverCloseTimers = new WeakMap<
  HTMLElement,
  ReturnType<typeof globalThis.setTimeout>
>();
const copiedTimers = new WeakMap<
  HTMLElement,
  ReturnType<typeof globalThis.setTimeout>
>();

function isDesktopHoverMode(): boolean {
  if (typeof globalThis.matchMedia !== "function") return false;
  return !globalThis.matchMedia(DESKTOP_HOVER_QUERY).matches;
}

function prefersReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== "function") return false;
  return globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function clearHoverCloseTimer(toc: HTMLElement): void {
  const timer = hoverCloseTimers.get(toc);
  if (timer !== undefined) {
    globalThis.clearTimeout(timer);
    hoverCloseTimers.delete(toc);
  }
}

function setOpen(toc: HTMLElement, open: boolean): void {
  clearHoverCloseTimer(toc);
  toc.toggleAttribute("data-open", open);
  toc
    .querySelector(TRIGGER_SELECTOR)
    ?.setAttribute("aria-expanded", String(open));

  if (open) {
    const panel = toc.querySelector<HTMLElement>(PANEL_SELECTOR);
    const activeLink = toc.querySelector<HTMLElement>(
      '[aria-current="location"]',
    );
    if (
      panel &&
      activeLink &&
      panel.scrollHeight > panel.clientHeight &&
      typeof activeLink.scrollIntoView === "function"
    ) {
      activeLink.scrollIntoView({ block: "nearest" });
    }
  }
}

function updateScrollability(toc: HTMLElement): boolean {
  const viewportHeight = globalThis.innerHeight;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    toc.setAttribute("data-toc-active", "");
    return true;
  }

  const postView =
    toc.closest<HTMLElement>("[data-post-view]") ?? document.body;
  const body =
    postView?.querySelector<HTMLElement>("[data-post-body]") ?? postView;
  const bodyHeight = body?.getBoundingClientRect().height ?? 0;
  const scrollHeight = document.scrollingElement?.scrollHeight ?? 0;

  // Headless DOM test environments report 0 for all layout metrics unless
  // stubbed; keep the TOC active there so interaction tests work naturally.
  const active =
    (bodyHeight === 0 && scrollHeight === 0) ||
    (bodyHeight >= viewportHeight * MIN_BODY_VIEWPORT_RATIO &&
      scrollHeight >= viewportHeight * MIN_SCROLL_VIEWPORT_RATIO);

  toc.toggleAttribute("data-toc-active", active);
  if (!active && toc.hasAttribute("data-open")) {
    setOpen(toc, false);
  }
  return active;
}

function observePostBody(toc: HTMLElement): void {
  if (typeof globalThis.ResizeObserver === "undefined") return;
  const postView = toc.closest<HTMLElement>("[data-post-view]");
  const body =
    postView?.querySelector<HTMLElement>("[data-post-body]") ??
    postView ??
    null;
  if (body === observedBody) return;

  bodyResizeObserver?.disconnect();
  observedBody = body;
  if (!body) {
    bodyResizeObserver = null;
    return;
  }

  bodyResizeObserver = new globalThis.ResizeObserver(() => {
    const activeToc = document.querySelector<HTMLElement>(TOC_SELECTOR);
    if (!activeToc) return;
    updateScrollability(activeToc);
    scheduleCurrentSection();
  });
  bodyResizeObserver.observe(body);
}

function syncActiveIndicators(
  toc: HTMLElement,
  currentLink: HTMLAnchorElement | undefined,
): void {
  const previousLink = toc.querySelector('[aria-current="location"]');
  if (previousLink !== currentLink) {
    previousLink?.removeAttribute("aria-current");
    currentLink?.setAttribute("aria-current", "location");
  }

  const activeId = currentLink?.dataset.postTocLink ?? "";
  for (const tick of toc.querySelectorAll<HTMLElement>(TICK_SELECTOR)) {
    tick.toggleAttribute("data-active", tick.dataset.postTocTick === activeId);
  }
}

function scheduleCurrentSection(): void {
  if (frame !== undefined) return;
  frame = globalThis.requestAnimationFrame(() => {
    frame = undefined;
    const toc = document.querySelector<HTMLElement>(TOC_SELECTOR);
    if (!toc) return;
    const links = [...toc.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR)];
    if (links.length === 0) return;

    const scrolling = document.scrollingElement;
    const atEnd =
      Boolean(scrolling) &&
      (scrolling?.scrollTop ?? 0) > 0 &&
      (scrolling?.scrollTop ?? 0) + (scrolling?.clientHeight ?? 0) >=
        (scrolling?.scrollHeight ?? 0) - 2;

    let current: HTMLAnchorElement | undefined;
    for (const link of links) {
      const heading = document.getElementById(link.dataset.postTocLink ?? "");
      if (!heading) continue;
      const offset = Number.parseFloat(
        getComputedStyle(heading).scrollMarginBlockStart,
      );
      const line = atEnd ? globalThis.innerHeight : (offset || 64) + 16;
      if (heading.getBoundingClientRect().top > line) break;
      current = link;
    }

    syncActiveIndicators(toc, current ?? links[0]);
  });
}

function bindTocElement(toc: HTMLElement): void {
  if (boundTocs.has(toc)) return;
  boundTocs.add(toc);

  toc.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch" || !isDesktopHoverMode()) return;
    if (!toc.hasAttribute("data-toc-active")) return;
    clearHoverCloseTimer(toc);
    if (!toc.hasAttribute("data-open")) {
      document.dispatchEvent(
        new CustomEvent("basecoat:popover", { detail: { source: toc } }),
      );
      setOpen(toc, true);
    }
  });

  toc.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "touch" || !isDesktopHoverMode()) return;
    clearHoverCloseTimer(toc);
    const timer = globalThis.setTimeout(() => {
      hoverCloseTimers.delete(toc);
      if (toc.contains(document.activeElement)) return;
      setOpen(toc, false);
    }, HOVER_CLOSE_DELAY_MS);
    hoverCloseTimers.set(toc, timer);
  });

  toc.addEventListener("focusout", (event) => {
    if (!toc.hasAttribute("data-open")) return;
    const next = event.relatedTarget;
    if (next instanceof globalThis.Node && toc.contains(next)) return;
    if (isDesktopHoverMode() && toc.matches(":hover")) return;
    setOpen(toc, false);
  });
}

function handleHeadingAnchorClick(
  event: globalThis.MouseEvent,
  anchor: HTMLAnchorElement,
): void {
  if (
    event.button ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  const href = anchor.getAttribute("href");
  if (!href?.startsWith("#")) return;
  event.preventDefault();

  if (globalThis.location.hash !== href) {
    globalThis.history.replaceState(null, "", href);
  }

  const fullUrl = new URL(href, globalThis.location.href).href;
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    void clipboard.writeText(fullUrl).catch(() => {});
  }

  const existingTimer = copiedTimers.get(anchor);
  if (existingTimer !== undefined) {
    globalThis.clearTimeout(existingTimer);
  }
  anchor.setAttribute("data-copied", "");
  const timer = globalThis.setTimeout(() => {
    anchor.removeAttribute("data-copied");
    copiedTimers.delete(anchor);
  }, COPIED_RESET_MS);
  copiedTimers.set(anchor, timer);
}

function installGlobalListeners(): void {
  if (listening) return;
  listening = true;

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof globalThis.Element)) return;

    const headingAnchor = event.target.closest<HTMLAnchorElement>(
      HEADING_ANCHOR_SELECTOR,
    );
    if (headingAnchor) {
      handleHeadingAnchorClick(event, headingAnchor);
      return;
    }

    const activeToc = document.querySelector<HTMLElement>(TOC_SELECTOR);
    if (!activeToc) return;

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
      ) {
        return;
      }
      const heading = document.getElementById(link.dataset.postTocLink ?? "");
      if (!heading) return;
      event.preventDefault();
      setOpen(activeToc, false);
      if (globalThis.location.hash !== link.hash) {
        globalThis.history.pushState(null, "", link.hash);
      }
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({
        block: "start",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
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
  globalThis.addEventListener("resize", () => {
    const activeToc = document.querySelector<HTMLElement>(TOC_SELECTOR);
    if (activeToc) updateScrollability(activeToc);
    scheduleCurrentSection();
  });
  globalThis.addEventListener("hashchange", scheduleCurrentSection);
}

/**
 * Enable the post heading copy-link anchors and the adaptive table of contents
 * (left-margin tick minimap on wide desktop screens, floating trigger on narrow
 * and touch screens).
 *
 * @param root - The document or newly inserted post view fragment
 * @returns Nothing
 * @example
 * initPostToc(document);
 */
export function initPostToc(
  root: globalThis.Document | globalThis.Element,
): void {
  const hasAnchors = Boolean(root.querySelector(HEADING_ANCHOR_SELECTOR));
  const toc = root.querySelector<HTMLElement>(TOC_SELECTOR);
  if (!toc && !hasAnchors) return;

  installGlobalListeners();
  if (!toc) return;

  toc.setAttribute("data-ready", "");
  bindTocElement(toc);
  updateScrollability(toc);
  observePostBody(toc);
  scheduleCurrentSection();
}

if (typeof document !== "undefined") {
  initPostToc(document);
}
