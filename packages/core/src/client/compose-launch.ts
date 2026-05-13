import type { JantComposeDialog } from "./components/jant-compose-dialog.js";

interface ReplyToData {
  contentHtml: string;
  dateText: string;
}

interface ReplyRefreshTarget {
  kind: "timeline-item" | "post-card" | "post-view";
  id: string;
}

export interface ComposeOpenOptions {
  collectionId?: string;
  restoreDraft?: boolean;
  initialFormat?: "note" | "link" | "quote";
}

export function getComposeDialog(): JantComposeDialog | null {
  return document.querySelector(
    "jant-compose-dialog",
  ) as JantComposeDialog | null;
}

export function getActiveCollectionId(): string | undefined {
  return (
    document.querySelector<HTMLElement>(
      "[data-page='collection'][data-collection-id]",
    )?.dataset.collectionId || undefined
  );
}

export function getCurrentDetailPostArticle(
  root: globalThis.Document | globalThis.Element = document,
): HTMLElement | null {
  if (root === document) {
    const hoveredPost = document.querySelector<HTMLElement>(
      "[data-page='post'] article[data-post]:hover",
    );
    if (hoveredPost) return hoveredPost;
  }

  const currentPost = root.querySelector<HTMLElement>(
    "[data-post-current] article[data-post]",
  );
  if (currentPost) return currentPost;

  const postView = root.querySelector<HTMLElement>(
    "[data-post-view] article[data-post]",
  );
  if (postView) return postView;

  if (root === document) {
    return document.querySelector<HTMLElement>("article[data-post]:hover");
  }

  return null;
}

export function getReplyRefreshTarget(
  article: HTMLElement,
): ReplyRefreshTarget | null {
  const postView = article.closest<HTMLElement>("[data-post-view]");
  const postViewId = postView?.dataset.postViewId;
  if (postViewId) {
    return { kind: "post-view", id: postViewId };
  }

  // Any page that renders posts inside a [data-timeline-item] wrapper
  // (home feed, archive list view, etc.) uses the timeline-item refresh
  // path so the full TimelineFeedItemContent — including thread previews —
  // re-renders with the new reply folded in.
  const timelineItem = article.closest<HTMLElement>("[data-timeline-item]");
  const threadRootId =
    timelineItem?.dataset.threadRootId ??
    article.dataset.threadRootId ??
    article.dataset.postId;
  if (timelineItem && threadRootId) {
    return { kind: "timeline-item", id: threadRootId };
  }

  const postId = article.dataset.postId;
  if (postId) {
    return { kind: "post-card", id: postId };
  }

  return null;
}

function getReplyData(article: HTMLElement): ReplyToData {
  const clone = article.cloneNode(true) as HTMLElement;
  clone.querySelector("[data-post-meta]")?.remove();
  clone.querySelector(".post-status-badges")?.remove();

  const timeEl = article.querySelector<HTMLElement>("time.dt-published");
  return {
    contentHtml: clone.innerHTML,
    dateText: timeEl?.textContent?.trim() ?? "",
  };
}

export async function openNewCompose(
  options?: ComposeOpenOptions,
): Promise<void> {
  await getComposeDialog()?.openNew(options);
}

export async function openReplyForArticle(article: HTMLElement): Promise<void> {
  const postId = article.dataset.postId;
  if (!postId) return;

  const dialog = getComposeDialog();
  if (!dialog) return;

  const threadRootId = article.dataset.threadRootId ?? postId;
  await dialog.openReply(
    postId,
    getReplyData(article),
    threadRootId,
    getReplyRefreshTarget(article) ?? undefined,
  );
}
