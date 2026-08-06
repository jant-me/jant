/**
 * Toast Utility
 *
 * Shared showToast() for all client-side bridge modules.
 * Appends a temporary notification to `#toast-container`.
 */

export type ToastType = "success" | "error";

export interface ToastAction {
  label: string;
  href: string;
}

interface QueuedToast {
  message: string;
  type: ToastType;
  action?: ToastAction;
}

export const QUEUED_TOAST_STORAGE_KEY = "jant.pendingToast";

function openModalDialogs(): HTMLDialogElement[] {
  const open = [
    ...document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
  ];
  try {
    const modal = open.filter((dialog) => dialog.matches(":modal"));
    if (modal.length > 0) return modal;
  } catch {
    // ":modal" unsupported — treat every open dialog as potentially modal.
  }
  // Engines without working ":modal" (happy-dom) match nothing above; Jant
  // only opens dialogs via showModal(), so open dialogs are the right proxy.
  return open;
}

/**
 * A modal <dialog> makes everything outside its subtree inert: the popover
 * promotion keeps toasts *painted* above the dialog, but clicks and text
 * selection would still fall through to the dialog. Mounting the container
 * inside the topmost open modal dialog escapes the inert tree; the close
 * watcher moves it back out when that dialog closes.
 */
function mountOutsideInertTree(container: HTMLElement): void {
  const dialogs = openModalDialogs();
  // Top-layer order isn't queryable; document order matches Jant's dialog
  // nesting (confirm dialogs are descendants of the dialog that opened them).
  const host = dialogs.at(-1) ?? document.body;
  if (container.parentElement !== host) host.appendChild(container);
}

/** Ensure the toast container is interactive and in the top layer (above <dialog> etc.) */
function ensureTopLayer(container: HTMLElement): void {
  mountOutsideInertTree(container);

  if (typeof container.showPopover !== "function") return;

  // Re-promote above any modal dialog that was opened after the toast container.
  if (
    container.matches(":popover-open") &&
    document.querySelector("dialog[open]")
  ) {
    container.hidePopover();
  }

  if (!container.matches(":popover-open")) {
    container.showPopover();
  }
}

function getToastContainer(): HTMLElement | null {
  const existing = document.getElementById("toast-container");
  if (existing) return existing;
  if (!document.body) return null;

  // The container can vanish with a modal dialog it was mounted into if that
  // dialog is removed from the DOM while open. Recreate it so toasts keep
  // working for the rest of the page's lifetime.
  const container = document.createElement("div");
  container.id = "toast-container";
  container.className = "toast-container";
  container.setAttribute("popover", "manual");
  container.setAttribute("aria-live", "polite");
  container.setAttribute("aria-relevant", "additions text");
  document.body.appendChild(container);
  return container;
}

function canUseSessionStorage(): boolean {
  try {
    return typeof globalThis.sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

function readQueuedToast(): QueuedToast | null {
  if (!canUseSessionStorage()) return null;

  const raw = globalThis.sessionStorage.getItem(QUEUED_TOAST_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<QueuedToast>;
    if (
      typeof parsed.message !== "string" ||
      (parsed.type !== "success" && parsed.type !== "error")
    ) {
      globalThis.sessionStorage.removeItem(QUEUED_TOAST_STORAGE_KEY);
      return null;
    }

    if (
      parsed.action &&
      (typeof parsed.action.label !== "string" ||
        typeof parsed.action.href !== "string")
    ) {
      globalThis.sessionStorage.removeItem(QUEUED_TOAST_STORAGE_KEY);
      return null;
    }

    return {
      message: parsed.message,
      type: parsed.type,
      action: parsed.action,
    };
  } catch {
    globalThis.sessionStorage.removeItem(QUEUED_TOAST_STORAGE_KEY);
    return null;
  }
}

const TOAST_ICONS = {
  success:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
  error:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
};

const TOAST_DURATION_MS = 3000;
const ACTION_TOAST_DURATION_MS = 5000;
const MIN_RESUME_MS = 1000;

/** Build toast inner content using safe DOM APIs (icon is trusted, text uses textContent). */
function setToastContent(
  toast: HTMLElement,
  type: ToastType,
  message: string,
  action?: ToastAction,
): void {
  toast.innerHTML = TOAST_ICONS[type];
  const span = document.createElement("span");
  span.textContent = message;
  toast.appendChild(span);
  if (action) {
    const a = document.createElement("a");
    a.href = action.href;
    a.className = "toast-action";
    a.textContent = action.label;
    toast.appendChild(a);
  }
}

/**
 * Auto-dismiss a toast after `duration`, pausing while the pointer hovers it
 * or focus is inside it — so the message can be read, selected, and copied.
 * On leave, the remaining time resumes (at least MIN_RESUME_MS).
 */
function scheduleAutoDismiss(toast: HTMLElement, duration: number): void {
  let remaining = duration;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hovered = false;
  let focused = false;

  const pause = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    remaining = Math.max(remaining - (Date.now() - startedAt), MIN_RESUME_MS);
  };

  const resume = () => {
    if (timer !== null) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      toast.classList.add("toast-out");
      toast.addEventListener("animationend", () => toast.remove());
    }, remaining);
  };

  const sync = () => {
    if (hovered || focused) {
      pause();
    } else {
      resume();
    }
  };

  toast.addEventListener("pointerenter", () => {
    hovered = true;
    sync();
  });
  toast.addEventListener("pointerleave", () => {
    hovered = false;
    sync();
  });
  toast.addEventListener("focusin", () => {
    focused = true;
    sync();
  });
  toast.addEventListener("focusout", () => {
    focused = false;
    sync();
  });

  resume();
}

/**
 * Show a toast notification.
 *
 * @param message - Text to display
 * @param type - Visual style: "success" (default) or "error"
 *
 * @example
 * showToast("Saved successfully.");
 * showToast("Something went wrong", "error");
 */
export function showToast(message: string, type: ToastType = "success"): void {
  if (!message) return;

  const container = getToastContainer();
  if (!container) return;

  ensureTopLayer(container);

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  setToastContent(toast, type, message);
  container.appendChild(toast);

  scheduleAutoDismiss(toast, TOAST_DURATION_MS);
}

/**
 * Show a toast with an action link.
 *
 * @param message - Text to display
 * @param action - Action link rendered beside the message
 * @param type - Visual style: "success" (default) or "error"
 *
 * @example
 * showToastWithAction("Post published.", { label: "View", href: "/p/abc" });
 */
export function showToastWithAction(
  message: string,
  action: ToastAction,
  type: ToastType = "success",
): void {
  if (!message) return;

  const container = getToastContainer();
  if (!container) return;

  ensureTopLayer(container);

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  setToastContent(toast, type, message, action);
  container.appendChild(toast);

  scheduleAutoDismiss(toast, ACTION_TOAST_DURATION_MS);
}

/**
 * Show a persistent toast that stays until explicitly dismissed.
 *
 * @param id - Unique identifier for updating/dismissing later
 * @param message - Text to display
 * @param type - Visual style: "success" (default) or "error"
 * @returns The toast element
 *
 * @example
 * showPersistentToast("upload", "Uploading...");
 */
export function showPersistentToast(
  id: string,
  message: string,
  type: ToastType = "success",
): HTMLElement | null {
  const container = getToastContainer();
  if (!container) return null;

  ensureTopLayer(container);

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.id = `toast-${id}`;
  setToastContent(toast, type, message);
  container.appendChild(toast);

  return toast;
}

/**
 * Update the message of an existing persistent toast.
 *
 * @param id - The toast identifier
 * @param message - New message text
 *
 * @example
 * updateToast("upload", "Almost done...");
 */
export function updateToast(id: string, message: string): void {
  const toast = document.getElementById(`toast-${id}`);
  if (!toast) return;

  const span = toast.querySelector("span");
  if (span) span.textContent = message;
}

/**
 * Dismiss a persistent toast with fadeout animation.
 *
 * @param id - The toast identifier
 *
 * @example
 * dismissToast("upload");
 */
export function dismissToast(id: string): void {
  const toast = document.getElementById(`toast-${id}`);
  if (!toast) return;

  toast.classList.add("toast-out");
  toast.addEventListener("animationend", () => toast.remove());
}

/**
 * Replace a persistent toast with an auto-dismissing one.
 *
 * @param id - The toast identifier
 * @param message - New message text
 * @param type - Visual style: "success" (default) or "error"
 *
 * @example
 * replaceWithAutoClose("upload", "Published!", "success");
 */
export function replaceWithAutoClose(
  id: string,
  message: string,
  type: ToastType = "success",
): void {
  const toast = document.getElementById(`toast-${id}`);
  if (!toast) {
    showToast(message, type);
    return;
  }

  toast.className = `toast toast-${type}`;
  toast.replaceChildren();
  setToastContent(toast, type, message);

  scheduleAutoDismiss(toast, TOAST_DURATION_MS);
}

/**
 * Replace a persistent toast with an auto-dismissing one that has an action link.
 *
 * @param id - The toast identifier
 * @param message - New message text
 * @param action - Action link rendered beside the message
 * @param type - Visual style: "success" (default) or "error"
 *
 * @example
 * replaceWithAutoCloseAction("upload", "Post published.", { label: "View", href: "/p/abc" });
 */
export function replaceWithAutoCloseAction(
  id: string,
  message: string,
  action: ToastAction,
  type: ToastType = "success",
): void {
  const toast = document.getElementById(`toast-${id}`);
  if (!toast) {
    showToastWithAction(message, action, type);
    return;
  }

  toast.className = `toast toast-${type}`;
  toast.replaceChildren();
  setToastContent(toast, type, message, action);

  scheduleAutoDismiss(toast, ACTION_TOAST_DURATION_MS);
}

/**
 * Queue a toast to be shown after the next navigation or reload.
 *
 * @param message - Text to display on the next page
 * @param type - Visual style: "success" (default) or "error"
 * @param action - Optional action link rendered on the destination page
 */
export function queueToastForNextPage(
  message: string,
  type: ToastType = "success",
  action?: ToastAction,
): void {
  if (!message || !canUseSessionStorage()) return;

  globalThis.sessionStorage.setItem(
    QUEUED_TOAST_STORAGE_KEY,
    JSON.stringify({ message, type, action } satisfies QueuedToast),
  );
}

/**
 * Show a queued toast, if one exists for the current page load.
 *
 * @returns True when a queued toast was consumed
 */
export function consumeQueuedToast(): boolean {
  const queued = readQueuedToast();
  if (!queued || !getToastContainer()) return false;

  globalThis.sessionStorage.removeItem(QUEUED_TOAST_STORAGE_KEY);

  if (queued.action) {
    showToastWithAction(queued.message, queued.action, queued.type);
  } else {
    showToast(queued.message, queued.type);
  }

  return true;
}

function initDialogCloseWatcher(): void {
  // "close" doesn't bubble; capture reaches it from the document anyway.
  document.addEventListener(
    "close",
    (event) => {
      const dialog = event.target;
      if (!(dialog instanceof HTMLDialogElement)) return;

      const container = document.getElementById("toast-container");
      if (!container || !dialog.contains(container)) return;

      // The closed dialog is display:none — move the container back out
      // (into the next open modal dialog, if any) so live toasts stay visible.
      ensureTopLayer(container);
    },
    true,
  );
}

function initQueuedToastConsumer(): void {
  const showQueuedToast = () => {
    consumeQueuedToast();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showQueuedToast, {
      once: true,
    });
    return;
  }

  showQueuedToast();
}

initDialogCloseWatcher();
initQueuedToastConsumer();
