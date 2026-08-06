/**
 * In-place refresh of a rendered Post.
 *
 * Reply submission, draft publishing, and anything else that changes a Post
 * server-side needs the same thing afterwards: re-render exactly the surface
 * the Post is shown on — a thread page, a feed item, or a standalone card —
 * without a full page load.
 */

import { hydratePartial } from "./hydrate-partial.js";
import { getReplyRefreshTarget } from "./compose-launch.js";

async function fetchPartialHtml(path: string): Promise<string | null> {
  const res = await fetch(path, {
    headers: { Accept: "text/html" },
  });
  if (!res.ok) return null;
  return res.text();
}

export async function refreshTimelineThreadView(
  threadRootId: string,
): Promise<boolean> {
  try {
    const timelineItem = document.querySelector<HTMLElement>(
      `[data-timeline-item][data-thread-root-id="${threadRootId}"]`,
    );
    const content = timelineItem?.querySelector<HTMLElement>(
      "[data-timeline-item-content]",
    );
    if (!content) return false;

    const html = await fetchPartialHtml(
      `/_/timeline-item/${encodeURIComponent(threadRootId)}`,
    );
    if (!html) return false;

    content.innerHTML = html;
    // Swapped-in markup carries interactions whose per-element setup only runs
    // on DOMContentLoaded (thread "Show more" toggle, feed video autoplay, audio
    // waveform); re-initialize them or they stay inert until a full reload.
    hydratePartial(content);
    return true;
  } catch {
    return false;
  }
}

export async function refreshPostCardView(postId: string): Promise<boolean> {
  try {
    const timelineItem = document
      .querySelector<HTMLElement>(`article[data-post-id="${postId}"]`)
      ?.closest<HTMLElement>("[data-timeline-item]");
    const html = await fetchPartialHtml(
      `/_/post-card/${encodeURIComponent(postId)}`,
    );
    if (!html) return false;

    if (timelineItem) {
      const content = timelineItem.querySelector<HTMLElement>(
        "[data-timeline-item-content]",
      );
      if (!content) return false;
      content.innerHTML = html;
      hydratePartial(content);
      return true;
    }

    const article = document.querySelector<HTMLElement>(
      `article[data-post-id="${postId}"]`,
    );
    if (!article) return false;

    article.outerHTML = html;
    // outerHTML detaches `article`; re-query the replacement to hydrate it.
    const nextArticle = document.querySelector<HTMLElement>(
      `article[data-post-id="${postId}"]`,
    );
    if (nextArticle) hydratePartial(nextArticle);
    return true;
  } catch {
    return false;
  }
}

export async function refreshPostPageView(postId: string): Promise<boolean> {
  try {
    const container = document.querySelector<HTMLElement>(
      `[data-post-view][data-post-view-id="${postId}"]`,
    );
    if (!container) return false;

    const html = await fetchPartialHtml(
      `/_/post-view/${encodeURIComponent(postId)}`,
    );
    if (!html) return false;

    container.outerHTML = html;
    // outerHTML detaches `container`; re-query the replacement to hydrate it
    // (see refreshTimelineThreadView).
    const next = document.querySelector<HTMLElement>(
      `[data-post-view][data-post-view-id="${postId}"]`,
    );
    if (next) hydratePartial(next);
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-renders whichever surface an article belongs to, reusing the same
 * targeting the reply flow uses.
 *
 * @param article - The rendered `article[data-post]` element to refresh
 * @returns Whether a surface was found and re-rendered
 * @example
 * ```ts
 * if (!(await refreshArticleView(article))) globalThis.location.reload();
 * ```
 */
export async function refreshArticleView(
  article: HTMLElement,
): Promise<boolean> {
  const target = getReplyRefreshTarget(article);
  if (!target) return false;

  if (target.kind === "timeline-item") {
    return refreshTimelineThreadView(target.id);
  }
  if (target.kind === "post-view") {
    return refreshPostPageView(target.id);
  }
  return refreshPostCardView(target.id);
}
