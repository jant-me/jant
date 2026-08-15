/**
 * Site Header — Mobile Drawer + More Dropdown
 *
 * Toggles a slide-in drawer on mobile for navigation and search.
 * Manages the "More" dropdown popover.
 */

const moreControllers = new WeakMap();
const drawerControllers = new WeakMap();

/** Header dropdowns, in the order they appear: the "More" nav overflow and,
 *  on a multilingual site, the language switcher. Both behave identically —
 *  click to toggle, outside click or Escape to close, opening one closes the
 *  other via the shared `basecoat:popover` event. */
const DROPDOWNS = [
  { trigger: ".site-header-more-btn", popover: ".site-header-more-popover" },
  { trigger: ".site-header-lang-btn", popover: ".site-header-lang-popover" },
];

function initDropdown(root, triggerSelector, popoverSelector) {
  const trigger = root.querySelector(triggerSelector);
  const popover = root.querySelector(popoverSelector);

  if (!trigger || !popover) return;
  if (trigger.dataset.moreInitialized === "true") return;
  trigger.dataset.moreInitialized = "true";
  const controller = new AbortController();
  const signal = controller.signal;
  moreControllers.set(trigger, controller);

  function open() {
    popover.setAttribute("aria-hidden", "false");
    trigger.setAttribute("aria-expanded", "true");
    document.dispatchEvent(
      new CustomEvent("basecoat:popover", {
        detail: { source: trigger.parentElement },
      }),
    );
  }

  function close(focusTrigger = false) {
    popover.setAttribute("aria-hidden", "true");
    trigger.setAttribute("aria-expanded", "false");
    if (focusTrigger) trigger.focus();
  }

  trigger.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (trigger.getAttribute("aria-expanded") === "true") {
        close();
      } else {
        open();
      }
    },
    { signal },
  );

  document.addEventListener(
    "click",
    (e) => {
      if (!(e.target instanceof Node)) return;
      if (!trigger.parentElement?.contains(e.target)) close();
    },
    { signal },
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (
        e.key === "Escape" &&
        popover.getAttribute("aria-hidden") === "false"
      ) {
        close(true);
      }
    },
    { signal },
  );

  document.addEventListener(
    "basecoat:popover",
    (e) => {
      if (e.detail?.source !== trigger.parentElement) close();
    },
    { signal },
  );
}

const FRESH_VISIT_KEY = "jant:nav-fresh-visits";

function createFreshBadge() {
  const badge = document.createElement("span");
  badge.className = "site-header-link-fresh";
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = "*";
  return badge;
}

function initNavFreshness(root) {
  try {
    const stored = JSON.parse(localStorage.getItem(FRESH_VISIT_KEY) || "{}");
    const currentPath = location.pathname;

    const freshLinks = root.querySelectorAll("[data-fresh-at]");
    for (const link of freshLinks) {
      const href = new URL(link.href).pathname;
      const freshAt = parseInt(link.dataset.freshAt, 10);

      if (href === currentPath) {
        // User is on this collection page — record the visit
        stored[href] = Math.floor(Date.now() / 1000);
      } else {
        // Show dot only if user hasn't visited since the last update
        const visitedAt = stored[href];
        if (!visitedAt || visitedAt < freshAt) {
          // Insert dot after the text, before any external link icon
          const icon = link.querySelector("svg");
          link.insertBefore(createFreshBadge(), icon);
        }
      }
    }

    localStorage.setItem(FRESH_VISIT_KEY, JSON.stringify(stored));
  } catch {
    // localStorage unavailable or corrupted — ignore
  }
}

export function initSiteHeaderNav(root = document) {
  const hamburger = root.querySelector(".site-header-hamburger");
  const drawer = root.querySelector("#site-nav-drawer");
  const backdrop = root.querySelector(".site-nav-drawer-backdrop");
  const closeBtn = drawer?.querySelector(".site-nav-drawer-close");

  // --- Freshness indicators ---
  initNavFreshness(root);

  // --- Header dropdowns ---
  for (const { trigger, popover } of DROPDOWNS) {
    initDropdown(root, trigger, popover);
  }

  // --- Mobile drawer ---
  if (!hamburger || !drawer || !backdrop) return;
  if (hamburger.dataset.drawerInitialized === "true") return;
  hamburger.dataset.drawerInitialized = "true";
  const controller = new AbortController();
  const signal = controller.signal;
  drawerControllers.set(hamburger, controller);

  function open() {
    drawer.setAttribute("aria-hidden", "false");
    drawer.removeAttribute("inert");
    backdrop.setAttribute("aria-hidden", "false");
    hamburger.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("drawer-open");

    const firstFocusable =
      drawer.querySelector(".site-nav-drawer-close") ??
      drawer.querySelector("a[href], button");
    if (firstFocusable) firstFocusable.focus();
  }

  function close(returnFocus = true) {
    drawer.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
    hamburger.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("drawer-open");

    drawer.addEventListener(
      "transitionend",
      () => {
        if (drawer.getAttribute("aria-hidden") === "true") {
          drawer.setAttribute("inert", "");
        }
      },
      { once: true, signal },
    );

    if (returnFocus) hamburger.focus();
  }

  hamburger.addEventListener(
    "click",
    () => {
      if (hamburger.getAttribute("aria-expanded") === "true") {
        close();
      } else {
        open();
      }
    },
    { signal },
  );

  closeBtn?.addEventListener("click", () => close(), { signal });
  backdrop.addEventListener("click", () => close(), { signal });
  drawer.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("a[href]")) {
        close(false);
      }
    },
    { signal },
  );

  drawer.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    },
    { signal },
  );
}

export function destroySiteHeaderNav(root = document) {
  const triggerSelector = DROPDOWNS.map((d) => d.trigger).join(", ");
  for (const trigger of root.querySelectorAll(triggerSelector)) {
    const controller = moreControllers.get(trigger);
    controller?.abort();
    moreControllers.delete(trigger);
    delete trigger.dataset.moreInitialized;
  }

  for (const hamburger of root.querySelectorAll(".site-header-hamburger")) {
    const controller = drawerControllers.get(hamburger);
    controller?.abort();
    drawerControllers.delete(hamburger);
    delete hamburger.dataset.drawerInitialized;
  }

  document.documentElement.classList.remove("drawer-open");
}

initSiteHeaderNav();
