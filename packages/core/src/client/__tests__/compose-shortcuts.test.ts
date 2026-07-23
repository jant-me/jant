// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { __testOnly as composeDiscoveryTestOnly } from "../compose-discovery.js";
import { __testOnly as composeShortcutsTestOnly } from "../compose-shortcuts.js";

type ComposeHarness = HTMLElement & {
  openNew: (options?: unknown) => Promise<void>;
  openReply: (...args: unknown[]) => Promise<void>;
  openEdit: (id: string) => Promise<void>;
  openDraft: (id: string) => Promise<void>;
};

function dispatchShortcut(
  target: globalThis.Document | globalThis.Element,
  key: string,
): globalThis.KeyboardEvent {
  const event = new globalThis.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function createComposeHarness(): ComposeHarness {
  const composeEl = document.createElement(
    "jant-compose-dialog",
  ) as ComposeHarness;
  composeEl.openNew = vi.fn(async () => {});
  composeEl.openReply = vi.fn(async () => {});
  composeEl.openEdit = vi.fn(async () => {});
  composeEl.openDraft = vi.fn(async () => {});
  document.body.appendChild(composeEl);
  return composeEl;
}

function renderThreadDetailPage() {
  const postView = document.createElement("div");
  postView.dataset.postView = "";
  postView.dataset.postViewId = "post-current";

  const threadGroup = document.createElement("div");
  threadGroup.dataset.page = "post";
  threadGroup.className = "thread-group thread-group-detail";

  const currentItem = document.createElement("div");
  currentItem.className = "thread-item thread-detail-item";
  currentItem.dataset.postCurrent = "";

  const currentArticle = document.createElement("article");
  currentArticle.dataset.post = "";
  currentArticle.dataset.postId = "post-current";
  currentArticle.dataset.threadRootId = "thread-root";
  currentArticle.dataset.format = "note";
  currentArticle.innerHTML = `
    <div data-post-meta>meta</div>
    <time class="dt-published">Mar 19</time>
    <div data-post-body>Current body</div>
  `;

  const hoveredItem = document.createElement("div");
  hoveredItem.className = "thread-item thread-detail-item";

  const hoveredArticle = document.createElement("article");
  hoveredArticle.dataset.post = "";
  hoveredArticle.dataset.postId = "post-hovered";
  hoveredArticle.dataset.threadRootId = "thread-root";
  hoveredArticle.dataset.format = "quote";
  hoveredArticle.innerHTML = `
    <div data-post-meta>meta</div>
    <time class="dt-published">Mar 20</time>
    <div data-post-body>Hovered body</div>
  `;

  const latestItem = document.createElement("div");
  latestItem.className = "thread-item thread-detail-item";

  const latestArticle = document.createElement("article");
  latestArticle.dataset.post = "";
  latestArticle.dataset.postId = "post-latest";
  latestArticle.dataset.threadRootId = "thread-root";
  latestArticle.dataset.format = "note";
  latestArticle.innerHTML = `
    <div data-post-meta>meta</div>
    <time class="dt-published">Mar 21</time>
    <div data-post-body>Latest body</div>
  `;

  currentItem.appendChild(currentArticle);
  hoveredItem.appendChild(hoveredArticle);
  latestItem.appendChild(latestArticle);
  threadGroup.appendChild(currentItem);
  threadGroup.appendChild(hoveredItem);
  threadGroup.appendChild(latestItem);
  postView.appendChild(threadGroup);
  document.body.appendChild(postView);

  return { currentArticle, hoveredArticle, latestArticle };
}

describe("compose shortcuts", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    globalThis.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("opens a collection-scoped composer on collection pages with n", () => {
    const composeEl = createComposeHarness();

    const collectionPage = document.createElement("div");
    collectionPage.dataset.page = "collection";
    collectionPage.dataset.collectionId = "col-2";
    document.body.appendChild(collectionPage);

    const event = dispatchShortcut(document, "n");

    expect(event.defaultPrevented).toBe(true);
    expect(composeEl.openNew).toHaveBeenCalledWith({ collectionId: "col-2" });
  });

  it("marks the compose shortcut as discovered when n opens the composer", async () => {
    createComposeHarness();

    dispatchShortcut(document, "n");
    await Promise.resolve();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      composeDiscoveryTestOnly.COMPOSE_OPEN_SHORTCUT_DISCOVERY_API_PATH,
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      composeDiscoveryTestOnly.readComposeOpenShortcutDiscoveryState(),
    ).toMatchObject({
      completed: true,
    });
  });

  it("ignores n while focus is inside an input", () => {
    const composeEl = createComposeHarness();

    const input = document.createElement("textarea");
    document.body.appendChild(input);

    dispatchShortcut(input, "n");

    expect(composeEl.openNew).not.toHaveBeenCalled();
  });

  it("opens a reply composer for the latest thread post on detail pages with r", () => {
    const composeEl = createComposeHarness();

    const postView = document.createElement("div");
    postView.dataset.postView = "";
    postView.dataset.postViewId = "post-current";

    const current = document.createElement("div");
    current.className = "thread-item thread-detail-item";
    current.dataset.postCurrent = "";

    const currentArticle = document.createElement("article");
    currentArticle.dataset.post = "";
    currentArticle.dataset.postId = "post-current";
    currentArticle.dataset.threadRootId = "thread-root";
    currentArticle.dataset.format = "quote";
    currentArticle.innerHTML = `
      <div data-post-meta>meta</div>
      <div class="post-status-badges">badges</div>
      <time class="dt-published">Mar 19</time>
      <div data-post-body>Current body</div>
    `;

    const latest = document.createElement("div");
    latest.className = "thread-item thread-detail-item";

    const latestArticle = document.createElement("article");
    latestArticle.dataset.post = "";
    latestArticle.dataset.postId = "post-latest";
    latestArticle.dataset.threadRootId = "thread-root";
    latestArticle.dataset.format = "quote";
    latestArticle.innerHTML = `
      <div data-post-meta>meta</div>
      <div class="post-status-badges">badges</div>
      <time class="dt-published">Mar 21</time>
      <div data-post-body>Latest reply body</div>
    `;

    const threadGroup = document.createElement("div");
    threadGroup.dataset.page = "post";
    threadGroup.className = "thread-group thread-group-detail";

    current.appendChild(currentArticle);
    latest.appendChild(latestArticle);
    threadGroup.appendChild(current);
    threadGroup.appendChild(latest);
    postView.appendChild(threadGroup);
    document.body.appendChild(postView);

    const event = dispatchShortcut(document, "r");

    expect(event.defaultPrevented).toBe(true);
    expect(composeEl.openReply).toHaveBeenCalledTimes(1);

    const [postId, replyData, threadRootId, refreshTarget] = vi.mocked(
      composeEl.openReply,
    ).mock.calls[0] ?? [null, null, null, null];

    expect(postId).toBe("post-latest");
    expect(threadRootId).toBe("thread-root");
    expect(refreshTarget).toEqual({ kind: "post-view", id: "post-current" });
    expect(vi.mocked(composeEl.openReply).mock.calls[0]?.[4]).toBeUndefined();
    expect(replyData).toMatchObject({ dateText: "Mar 21" });
    expect((replyData as { contentHtml: string }).contentHtml).toContain(
      "Latest reply body",
    );
    expect((replyData as { contentHtml: string }).contentHtml).not.toContain(
      "meta",
    );
    expect((replyData as { contentHtml: string }).contentHtml).not.toContain(
      "badges",
    );
  });

  it("targets the latest thread post for reply shortcuts even when an older post is hovered", () => {
    const composeEl = createComposeHarness();
    const { hoveredArticle } = renderThreadDetailPage();
    const originalQuerySelector = document.querySelector.bind(document);

    vi.spyOn(document, "querySelector").mockImplementation(
      (selector: string): globalThis.Element | null => {
        if (selector === "[data-page='post'] article[data-post]:hover") {
          return hoveredArticle;
        }
        return originalQuerySelector(selector);
      },
    );

    const event = dispatchShortcut(document, "r");

    expect(event.defaultPrevented).toBe(true);
    expect(composeEl.openReply).toHaveBeenCalledWith(
      "post-latest",
      expect.objectContaining({ dateText: "Mar 21" }),
      "thread-root",
      { kind: "post-view", id: "post-current" },
    );
  });

  it("prefers the hovered thread post for edit shortcuts on detail pages", async () => {
    const composeEl = createComposeHarness();
    composeEl.openEdit = vi.fn(async () => {});
    const { hoveredArticle } = renderThreadDetailPage();
    const originalQuerySelector = document.querySelector.bind(document);

    vi.spyOn(document, "querySelector").mockImplementation(
      (selector: string): globalThis.Element | null => {
        if (selector === "[data-page='post'] article[data-post]:hover") {
          return hoveredArticle;
        }
        return originalQuerySelector(selector);
      },
    );

    const event = dispatchShortcut(document, "e");
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(composeEl.openEdit).toHaveBeenCalledWith("post-hovered");
  });

  it("opens the current post editor from the edit query parameter", async () => {
    const composeEl = createComposeHarness();
    composeEl.openEdit = vi.fn(async () => {});
    document.body.setAttribute("data-authenticated", "true");
    renderThreadDetailPage();
    globalThis.history.pushState({}, "", "/about?edit=1");

    composeShortcutsTestOnly.openEditFromQueryParam();
    await Promise.resolve();

    expect(composeEl.openEdit).toHaveBeenCalledWith("post-current");
    expect(window.location.pathname).toBe("/about");
    expect(window.location.search).toBe("");
  });

  it("loads the current draft through the drafts workflow on preview pages", async () => {
    const composeEl = createComposeHarness();
    document.body.setAttribute("data-authenticated", "true");
    const previewBar = document.createElement("aside");
    previewBar.dataset.previewStatus = "";
    document.body.appendChild(previewBar);
    renderThreadDetailPage();
    globalThis.history.pushState({}, "", "/preview/draft-post?edit=1");

    composeShortcutsTestOnly.openEditFromQueryParam();
    await Promise.resolve();

    expect(composeEl.openDraft).toHaveBeenCalledWith("post-current");
    expect(composeEl.openEdit).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/preview/draft-post");
    expect(window.location.search).toBe("");
  });

  it("keeps using the hovered post for reply shortcuts in the timeline", () => {
    const composeEl = createComposeHarness();
    const article = document.createElement("article");
    article.dataset.post = "";
    article.dataset.postId = "timeline-post";
    article.dataset.threadRootId = "timeline-thread";
    article.innerHTML = `
      <div data-post-meta>meta</div>
      <time class="dt-published">Apr 5</time>
      <div data-post-body>Timeline body</div>
    `;
    document.body.appendChild(article);

    const originalQuerySelector = document.querySelector.bind(document);
    vi.spyOn(document, "querySelector").mockImplementation(
      (selector: string): globalThis.Element | null => {
        if (selector === "[data-page='post'] article[data-post]:hover") {
          return null;
        }
        if (selector === "article[data-post]:hover") {
          return article;
        }
        return originalQuerySelector(selector);
      },
    );

    const event = dispatchShortcut(document, "r");

    expect(event.defaultPrevented).toBe(true);
    expect(composeEl.openReply).toHaveBeenCalledTimes(1);

    const [postId, replyData, threadRootId, refreshTarget] = vi.mocked(
      composeEl.openReply,
    ).mock.calls[0] ?? [null, null, null, null];

    expect(postId).toBe("timeline-post");
    expect(replyData).toMatchObject({ dateText: "Apr 5" });
    expect(threadRootId).toBe("timeline-thread");
    expect(refreshTarget).toEqual({ kind: "post-card", id: "timeline-post" });
  });
});
