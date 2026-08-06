// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "../compose-bridge.js";
import { QUEUED_TOAST_STORAGE_KEY } from "../toast.js";

type ComposeHarness = HTMLElement & {
  clearLocalDraftFromStorage?: () => void;
  clearEditDraftFromStorage?: (postId: string) => void;
  openEdit?: (id: string) => Promise<void>;
  openDraft?: (id: string) => Promise<void>;
  openNew?: (options?: { restoreDraft?: boolean }) => Promise<void>;
  openReply?: (
    id: string,
    replyData?: unknown,
    threadRootId?: string,
    refreshTarget?: {
      kind: "timeline-item" | "post-card" | "post-view";
      id: string;
    },
    options?: { restoreDraft?: boolean; initialFormat?: string },
  ) => Promise<void>;
  refreshCollections: () => Promise<boolean>;
  pageMode?: boolean;
  preparePageLeave?: () => void;
  reset?: () => void;
  updateComplete?: Promise<void>;
  labels?: {
    uploadFailedDraft?: string;
    publishFailedDraft?: string;
    published?: string;
    view?: string;
  };
};

function flushAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushBridgeWork(times = 4) {
  for (let i = 0; i < times; i++) {
    await flushAsyncWork();
  }
}

function renderPostView(postId: string) {
  const postView = document.createElement("div");
  postView.dataset.postView = "";
  postView.dataset.postViewId = postId;
  document.body.appendChild(postView);
  return postView;
}

describe("compose bridge", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete document.documentElement.dataset.sitePathPrefix;
    vi.restoreAllMocks();
    globalThis.sessionStorage.clear();
  });

  it("keeps empty collectionIds in the request and refreshes compose collections after draft save", async () => {
    const composeEl = document.createElement(
      "jant-compose-dialog",
    ) as ComposeHarness;
    const refreshCollections = vi.fn(async () => true);
    composeEl.refreshCollections = refreshCollections;
    composeEl.pageMode = false;
    document.body.appendChild(composeEl);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const url = new URL(raw, "http://localhost");

        if (url.pathname === "/compose") {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toMatchObject({
            collectionIds: [],
            status: "draft",
          });

          return new Response(
            JSON.stringify({
              status: "draft",
              toast: "Draft saved.",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected fetch: ${url.pathname}`);
      });

    composeEl.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: {
          format: "note",
          title: "",
          body: "Draft body",
          url: "",
          quoteText: "",
          quoteAuthor: "",
          slug: "",
          status: "draft",
          visibility: "public",
          rating: 0,
          collectionIds: [],
          attachments: [],
          pendingAttachments: [],
        },
      }),
    );

    await flushBridgeWork();

    expect(fetchSpy).toHaveBeenCalled();
    expect(refreshCollections).toHaveBeenCalledTimes(1);
  });

  it("omits stale Collection state from Reply requests", async () => {
    const composeEl = document.createElement(
      "jant-compose-dialog",
    ) as ComposeHarness;
    composeEl.refreshCollections = vi.fn(async () => true);
    composeEl.pageMode = false;
    document.body.appendChild(composeEl);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const url = new URL(raw, "http://localhost");

        if (url.pathname === "/compose") {
          const body = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          expect(body.replyToId).toBe("pst_parent");
          expect(body).not.toHaveProperty("collectionIds");

          return new Response(
            JSON.stringify({ status: "draft", toast: "Draft saved." }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected fetch: ${url.pathname}`);
      });

    composeEl.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: {
          format: "note",
          title: "",
          body: "Reply draft",
          url: "",
          quoteText: "",
          quoteAuthor: "",
          status: "draft",
          rating: 0,
          collectionIds: ["col-stale"],
          attachments: [],
          pendingAttachments: [],
          replyToId: "pst_parent",
        },
      }),
    );

    await flushBridgeWork();

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("stays on page and resets form after page-mode publish", async () => {
    const composeEl = document.createElement(
      "jant-compose-dialog",
    ) as ComposeHarness;
    composeEl.refreshCollections = vi.fn(async () => true);
    composeEl.pageMode = true;
    composeEl.reset = vi.fn();
    composeEl.updateComplete = Promise.resolve();
    composeEl.labels = {
      published: "Published!",
      view: "View",
    };
    document.body.appendChild(composeEl);

    const assignSpy = vi
      .spyOn(globalThis.location, "assign")
      .mockImplementation(() => {});

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(raw, "http://localhost");

      if (url.pathname === "/compose") {
        return new Response(
          JSON.stringify({
            status: "published",
            permalink: "/published-post",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });

    composeEl.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: {
          format: "note",
          title: "",
          body: "Published body",
          url: "",
          quoteText: "",
          quoteAuthor: "",
          slug: "",
          status: "published",
          visibility: "public",
          rating: 0,
          collectionIds: [],
          attachments: [],
          pendingAttachments: [],
        },
      }),
    );

    await flushBridgeWork();

    expect(composeEl.reset).toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("submits inline text attachments through the attachments API shape", async () => {
    const composeEl = document.createElement(
      "jant-compose-dialog",
    ) as ComposeHarness;
    composeEl.refreshCollections = vi.fn(async () => true);
    composeEl.pageMode = false;
    document.body.appendChild(composeEl);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const url = new URL(raw, "http://localhost");

        if (url.pathname === "/compose") {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            attachments: [
              {
                type: "text",
                contentFormat: "markdown",
                content: "Attached body",
                summary: "Attached body",
              },
            ],
          });

          return new Response(
            JSON.stringify({
              status: "draft",
              toast: "Draft saved.",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected fetch: ${url.pathname}`);
      });

    composeEl.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: {
          format: "note",
          title: "",
          body: "Draft body",
          url: "",
          quoteText: "",
          quoteAuthor: "",
          slug: "",
          status: "draft",
          visibility: "public",
          rating: 0,
          collectionIds: [],
          attachments: [
            {
              type: "text",
              clientId: "t1",
              bodyJson: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Attached body" }],
                  },
                ],
              },
              summary: "Attached body",
            },
          ],
          pendingAttachments: [],
        },
      }),
    );

    await flushBridgeWork();

    expect(fetchSpy).toHaveBeenCalled();
  });

  it("sends publishedAt on publish and omits it when retrying as draft", async () => {
    const composeEl = document.createElement(
      "jant-compose-dialog",
    ) as ComposeHarness;
    composeEl.refreshCollections = vi.fn(async () => true);
    composeEl.pageMode = false;
    document.body.appendChild(composeEl);

    let requestCount = 0;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const url = new URL(raw, "http://localhost");

        if (url.pathname === "/compose") {
          requestCount += 1;
          const body = JSON.parse(String(init?.body)) as {
            status: string;
            publishedAt?: number;
          };

          if (requestCount === 1) {
            expect(body).toMatchObject({
              status: "published",
              publishedAt: 1705311000,
            });
            return new Response(JSON.stringify({ error: "Publish failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          expect(body.status).toBe("draft");
          expect(body.publishedAt).toBeUndefined();
          return new Response(
            JSON.stringify({
              status: "draft",
              toast: "Draft saved.",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected fetch: ${url.pathname}`);
      });

    composeEl.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: {
          format: "note",
          title: "",
          body: "Backdated publish",
          url: "",
          quoteText: "",
          quoteAuthor: "",
          slug: "",
          status: "published",
          publishedAt: 1705311000,
          visibility: "public",
          rating: 0,
          collectionIds: [],
          attachments: [],
          pendingAttachments: [],
        },
      }),
    );

    await flushBridgeWork();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reopens reply compose with local draft recovery after a thread validation error", async () => {
    const composeEl = document.createElement(
      "jant-compose-dialog",
    ) as ComposeHarness;
    composeEl.refreshCollections = vi.fn(async () => true);
    composeEl.pageMode = false;
    composeEl.openNew = vi.fn(async () => {});
    composeEl.openReply = vi.fn(async () => {});
    composeEl.clearLocalDraftFromStorage = vi.fn();
    document.body.appendChild(composeEl);

    let requestCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(raw, "http://localhost");

      if (url.pathname === "/compose/thread") {
        requestCount += 1;
        return new Response(
          JSON.stringify({ error: "Threads can include up to 20 posts." }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });

    composeEl.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: {
          format: "quote",
          title: "",
          body: "",
          url: "",
          quoteText: "",
          quoteAuthor: "",
          slug: "",
          status: "published",
          visibility: "public",
          rating: 0,
          collectionIds: [],
          attachments: [],
          pendingAttachments: [],
          replyToId: "pst_parent",
          replyThreadRootId: "pst_root",
          replyRefreshKind: "timeline-item",
          replyRefreshId: "pst_root",
          threadPosts: [
            {
              format: "quote",
              title: "",
              body: '{"type":"doc","content":[]}',
              url: "",
              quoteText: "",
              quoteAuthor: "",
              status: "published",
              visibility: "public",
              rating: 0,
              collectionIds: [],
              attachments: [],
              replyToId: "pst_parent",
            },
            {
              format: "note",
              title: "",
              body: '{"type":"doc","content":[]}',
              url: "",
              quoteText: "",
              quoteAuthor: "",
              status: "published",
              rating: 0,
              collectionIds: [],
              attachments: [],
            },
          ],
        },
      }),
    );

    await flushBridgeWork();

    expect(requestCount).toBe(2);
    expect(composeEl.openReply).toHaveBeenCalledWith(
      "pst_parent",
      undefined,
      "pst_root",
      { kind: "timeline-item", id: "pst_root" },
      {
        restoreDraft: true,
        initialFormat: "quote",
        restoreToast: false,
        restoreMedia: [],
      },
    );
    expect(composeEl.openNew).not.toHaveBeenCalled();
    expect(composeEl.clearLocalDraftFromStorage).not.toHaveBeenCalled();
  });

  it("re-binds the thread-context Show more toggle after a reply swaps in a thread preview", async () => {
    document.body.innerHTML = `
      <div data-timeline-item data-thread-root-id="pst_root">
        <div data-timeline-item-content>
          <article data-post data-post-id="pst_root">Root</article>
        </div>
      </div>
    `;

    const composeEl = document.createElement(
      "jant-compose-dialog",
    ) as ComposeHarness;
    composeEl.refreshCollections = vi.fn(async () => true);
    composeEl.pageMode = false;
    document.body.appendChild(composeEl);

    // The freshly rendered thread preview carries the collapsed ancestor shell
    // plus its "Show more" toggle — the markup the bug left inert until reload.
    const threadPreviewHtml = `
      <div class="thread-group thread-group-preview">
        <div class="thread-context-shell" data-thread-context data-collapsed="">
          <div class="thread-item"><article data-post>Root</article></div>
        </div>
        <button
          type="button"
          class="thread-context-toggle"
          data-thread-context-toggle
          data-label-more="Show more"
          data-label-less="Show less"
          aria-expanded="false"
        >
          <span class="thread-context-toggle-label">Show more</span>
        </button>
        <div class="thread-item thread-item-hero"><article data-post>Reply</article></div>
      </div>
    `;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(raw, "http://localhost");

      if (url.pathname === "/compose") {
        return new Response(
          JSON.stringify({ status: "published", permalink: "/the-reply" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.pathname === "/_/timeline-item/pst_root") {
        return new Response(threadPreviewHtml, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }

      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });

    composeEl.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: {
          format: "note",
          title: "",
          body: "A reply",
          url: "",
          quoteText: "",
          quoteAuthor: "",
          slug: "",
          status: "published",
          visibility: "public",
          rating: 0,
          collectionIds: [],
          attachments: [],
          pendingAttachments: [],
          replyToId: "pst_parent",
          replyThreadRootId: "pst_root",
          replyRefreshKind: "timeline-item",
          replyRefreshId: "pst_root",
        },
      }),
    );

    await flushBridgeWork();

    const toggle = document.querySelector<HTMLElement>(
      "[data-thread-context-toggle]",
    );
    const shell = document.querySelector<HTMLElement>("[data-thread-context]");
    expect(toggle).not.toBeNull();
    expect(shell).not.toBeNull();
    // setupThreadContexts ran on the swapped-in markup.
    expect(toggle?.dataset.threadContextToggleBound).toBe("1");

    // And the bound listener actually toggles the collapsed state.
    toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(shell?.dataset.collapsed).toBeUndefined();
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  });

  it("sends nulls for cleared quote attribution fields when editing", async () => {
    const composeEl = document.createElement(
      "jant-compose-dialog",
    ) as ComposeHarness;
    composeEl.refreshCollections = vi.fn(async () => true);
    composeEl.pageMode = false;
    document.body.appendChild(composeEl);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const url = new URL(raw, "http://localhost");

        if (url.pathname === "/api/posts/pst_123") {
          expect(init?.method).toBe("PUT");

          const body = JSON.parse(String(init?.body)) as {
            format: string;
            body: null;
            sourceName: null;
            sourceUrl: null;
            quoteText: string;
            rating: null;
          };

          expect(body).toMatchObject({
            format: "quote",
            body: null,
            sourceName: null,
            sourceUrl: null,
            quoteText: "The obstacle is the way.",
            rating: null,
          });

          return new Response(
            JSON.stringify({
              status: "draft",
              toast: "Draft saved.",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        // After a successful edit the bridge tries to refresh the post
        // card view in-place — return empty HTML so it gracefully no-ops.
        if (url.pathname === `/_/post-card/pst_123`) {
          return new Response("", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          });
        }

        throw new Error(`Unexpected fetch: ${url.pathname}`);
      });

    composeEl.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: {
          format: "quote",
          title: "",
          body: "",
          url: "",
          quoteText: "The obstacle is the way.",
          quoteAuthor: "",
          slug: "",
          status: "draft",
          visibility: "public",
          rating: 0,
          collectionIds: [],
          attachments: [],
          pendingAttachments: [],
          editPostId: "pst_123",
        },
      }),
    );

    await flushBridgeWork();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps an updated draft on its authenticated preview path", async () => {
    const composeEl = document.createElement(
      "jant-compose-dialog",
    ) as ComposeHarness;
    composeEl.refreshCollections = vi.fn(async () => true);
    composeEl.pageMode = false;
    document.body.appendChild(composeEl);
    const previewBar = document.createElement("aside");
    previewBar.dataset.previewStatus = "";
    document.body.appendChild(previewBar);
    document.documentElement.dataset.sitePathPrefix = "/blog";
    globalThis.history.replaceState({}, "", "/blog/preview/draft-post");

    const assignSpy = vi
      .spyOn(globalThis.location, "assign")
      .mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(raw, "http://localhost");

      expect(url.pathname).toBe("/api/posts/pst_draft");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        status: "draft",
      });

      return new Response(
        JSON.stringify({
          id: "pst_draft",
          slug: "draft-post",
          status: "draft",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    composeEl.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: {
          format: "note",
          title: "Draft post",
          body: "Updated draft body",
          url: "",
          quoteText: "",
          quoteAuthor: "",
          slug: "draft-post",
          status: "draft",
          visibility: "public",
          rating: 0,
          collectionIds: [],
          attachments: [],
          pendingAttachments: [],
          editPostId: "pst_draft",
          draftSourceId: "pst_draft",
        },
      }),
    );

    await flushBridgeWork();

    expect(assignSpy).toHaveBeenCalledWith("/blog/preview/draft-post");
  });

  it("keeps a draft-panel save in place and signals the updated list", async () => {
    const composeEl = document.createElement(
      "jant-compose-dialog",
    ) as ComposeHarness;
    const refreshCollections = vi.fn(async () => true);
    composeEl.refreshCollections = refreshCollections;
    composeEl.pageMode = false;
    document.body.appendChild(composeEl);

    const assignSpy = vi
      .spyOn(globalThis.location, "assign")
      .mockImplementation(() => {});
    const completeSpy = vi.fn();
    document.addEventListener("jant:compose-submit-complete", completeSpy, {
      once: true,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "pst_draft",
          slug: "draft-post",
          status: "draft",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    composeEl.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: {
          format: "note",
          title: "Draft post",
          body: "Updated draft body",
          url: "",
          quoteText: "",
          quoteAuthor: "",
          slug: "draft-post",
          status: "draft",
          visibility: "public",
          rating: 0,
          collectionIds: [],
          attachments: [],
          pendingAttachments: [],
          editPostId: "pst_draft",
          draftSourceId: "pst_draft",
        },
      }),
    );

    await flushBridgeWork();

    expect(assignSpy).not.toHaveBeenCalled();
    expect(refreshCollections).toHaveBeenCalled();
    expect(completeSpy).toHaveBeenCalledOnce();
  });

  it("reopens a failed server draft through the draft loader", async () => {
    const composeEl = document.createElement(
      "jant-compose-dialog",
    ) as ComposeHarness;
    composeEl.refreshCollections = vi.fn(async () => true);
    composeEl.pageMode = false;
    composeEl.openDraft = vi.fn(async () => {});
    composeEl.openEdit = vi.fn(async () => {});
    document.body.appendChild(composeEl);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Could not save draft." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    composeEl.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: {
          format: "note",
          title: "Draft post",
          body: "Updated draft body",
          url: "",
          quoteText: "",
          quoteAuthor: "",
          status: "draft",
          visibility: "public",
          rating: 0,
          collectionIds: [],
          attachments: [],
          pendingAttachments: [],
          editPostId: "pst_draft",
          draftSourceId: "pst_draft",
        },
      }),
    );

    await flushBridgeWork();

    expect(composeEl.openDraft).toHaveBeenCalledWith("pst_draft");
    expect(composeEl.openEdit).not.toHaveBeenCalled();
  });

  it("sends a published draft to its public permalink", async () => {
    const composeEl = document.createElement(
      "jant-compose-dialog",
    ) as ComposeHarness;
    composeEl.refreshCollections = vi.fn(async () => true);
    composeEl.pageMode = false;
    document.body.appendChild(composeEl);
    renderPostView("pst_draft");
    const previewBar = document.createElement("aside");
    previewBar.dataset.previewStatus = "";
    document.body.appendChild(previewBar);
    document.documentElement.dataset.sitePathPrefix = "/blog";
    globalThis.history.replaceState({}, "", "/blog/preview/draft-post");

    const assignSpy = vi
      .spyOn(globalThis.location, "assign")
      .mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "pst_draft",
          slug: "published-post",
          status: "published",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    composeEl.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: {
          format: "note",
          title: "Published post",
          body: "Ready to publish",
          url: "",
          quoteText: "",
          quoteAuthor: "",
          slug: "published-post",
          status: "published",
          visibility: "public",
          rating: 0,
          collectionIds: [],
          attachments: [],
          pendingAttachments: [],
          editPostId: "pst_draft",
          draftSourceId: "pst_draft",
        },
      }),
    );

    await flushBridgeWork();

    expect(assignSpy).toHaveBeenCalledWith("/blog/published-post");
  });
});
