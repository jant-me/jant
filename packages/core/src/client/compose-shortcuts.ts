import {
  getActiveCollectionId,
  getComposeDialog,
  getCurrentDetailPostArticle,
  getReplyTargetArticle,
  openNewCompose,
  openReplyForArticle,
} from "./compose-launch.js";
import { markComposeOpenShortcutDiscovered } from "./compose-discovery.js";
import type { JantPostMenu } from "./components/jant-post-menu.js";
import { showToast } from "./toast.js";

const INTERACTIVE_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[role='textbox']",
  ".ProseMirror",
].join(", ");

function isInteractiveTarget(target: globalThis.EventTarget | null): boolean {
  return (
    target instanceof globalThis.Element &&
    target.closest(INTERACTIVE_TARGET_SELECTOR) !== null
  );
}

function shouldIgnoreShortcut(event: globalThis.KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat) return true;
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  if (!getComposeDialog()) return true;
  if (document.querySelector('[data-page="compose"]')) return true;
  if (document.querySelector("dialog[open]")) return true;

  const activeTarget = document.activeElement;
  return (
    isInteractiveTarget(event.target) ||
    (activeTarget !== event.target && isInteractiveTarget(activeTarget))
  );
}

function hasEditQueryParam(): boolean {
  return new URL(window.location.href).searchParams.get("edit") === "1";
}

function consumeEditQueryParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("edit");
  const nextSearch = url.searchParams.toString();
  globalThis.history.replaceState(
    globalThis.history.state,
    "",
    `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`,
  );
}

function openEditFromQueryParam() {
  if (!document.body?.hasAttribute("data-authenticated")) return;
  if (!hasEditQueryParam()) return;

  const article = getCurrentDetailPostArticle();
  const postId = article?.dataset.postId;
  const composeEl = getComposeDialog();
  if (!postId || !composeEl) return;

  consumeEditQueryParam();
  if (document.querySelector("[data-preview-status]")) {
    void composeEl.openDraft(postId);
  } else {
    void composeEl.openEdit(postId);
  }
}

async function toggleFeatured(
  postId: string,
  featured: boolean,
  article: HTMLElement,
) {
  try {
    const res = await fetch(`/api/posts/${postId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured }),
    });
    if (!res.ok) throw new Error();

    if (featured) {
      article.setAttribute("data-post-featured", "");
    } else {
      article.removeAttribute("data-post-featured");
    }
    showToast(featured ? "Added to Featured." : "Removed from Featured.");
  } catch {
    showToast("Could not update post. Try again.", "error");
  }
}

document.addEventListener("keydown", (event: globalThis.KeyboardEvent) => {
  const key = event.key.toLowerCase();
  if (
    key !== "n" &&
    key !== "l" &&
    key !== "q" &&
    key !== "r" &&
    key !== "e" &&
    key !== "c" &&
    key !== "f"
  )
    return;
  if (shouldIgnoreShortcut(event)) return;

  if (key === "n" || key === "l" || key === "q") {
    event.preventDefault();
    markComposeOpenShortcutDiscovered();
    const collectionId = getActiveCollectionId();
    const initialFormat =
      key === "l" ? "link" : key === "q" ? "quote" : undefined;
    void openNewCompose({
      ...(collectionId ? { collectionId } : undefined),
      ...(initialFormat ? { initialFormat } : undefined),
    });
    return;
  }

  if (key === "r") {
    const article = getReplyTargetArticle();
    if (!article) return;
    event.preventDefault();
    void openReplyForArticle(article);
    return;
  }

  const article = getCurrentDetailPostArticle();
  if (!article) return;

  if (key === "e") {
    const postId = article.dataset.postId;
    if (!postId) return;
    event.preventDefault();
    const composeEl = getComposeDialog();
    if (composeEl) {
      void composeEl.openEdit(postId);
    }
    return;
  }

  if (key === "c") {
    event.preventDefault();
    const postMenu = document.querySelector<JantPostMenu>("jant-post-menu");
    if (postMenu) {
      postMenu.openCollectionsForPost(article);
    }
    return;
  }

  if (key === "f") {
    const postId = article.dataset.postId;
    if (!postId) return;
    event.preventDefault();
    const isFeatured = article.hasAttribute("data-post-featured");
    void toggleFeatured(postId, !isFeatured, article);
    return;
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", openEditFromQueryParam, {
    once: true,
  });
} else {
  openEditFromQueryParam();
}

export const __testOnly = {
  openEditFromQueryParam,
};
