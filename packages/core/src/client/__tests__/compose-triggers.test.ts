// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const launch = vi.hoisted(() => ({
  openNewCompose: vi.fn(async () => {}),
  openReplyForArticle: vi.fn(async () => {}),
  openEditForPost: vi.fn(async () => {}),
}));

vi.mock("../compose-launch.js", () => launch);

import "../compose-triggers.js";

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`expected ${selector} in DOM`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("compose triggers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    launch.openNewCompose.mockClear();
    launch.openReplyForArticle.mockClear();
    launch.openEditForPost.mockClear();
  });

  it("opens a new post from a [data-compose-open] button", () => {
    document.body.innerHTML = `<button data-compose-open><span>New</span></button>`;

    click("button span");

    expect(launch.openNewCompose).toHaveBeenCalledWith(undefined);
  });

  it("scopes the new post to the button's collection", () => {
    document.body.innerHTML = `<button data-compose-open data-compose-collection-id="col_1">New</button>`;

    click("button");

    expect(launch.openNewCompose).toHaveBeenCalledWith({
      collectionId: "col_1",
    });
  });

  it("replies to the post around a [data-reply-trigger]", () => {
    document.body.innerHTML = `
      <article data-post data-post-id="pst_1">
        <button data-reply-trigger>Reply</button>
      </article>`;

    click("[data-reply-trigger]");

    const article = document.querySelector("article");
    expect(launch.openReplyForArticle).toHaveBeenCalledWith(article);
  });

  it("ignores a reply trigger outside any post", () => {
    document.body.innerHTML = `<button data-reply-trigger>Reply</button>`;

    click("[data-reply-trigger]");

    expect(launch.openReplyForArticle).not.toHaveBeenCalled();
  });

  it("continues an inline draft from its badge, by its own or its post's id", () => {
    document.body.innerHTML = `
      <span data-draft-continue data-post-id="pst_draft">Draft</span>
      <article data-post data-post-id="pst_2">
        <span data-draft-continue>Draft</span>
      </article>`;

    click("[data-draft-continue][data-post-id]");
    click("article [data-draft-continue]");

    expect(launch.openEditForPost).toHaveBeenNthCalledWith(1, "pst_draft");
    expect(launch.openEditForPost).toHaveBeenNthCalledWith(2, "pst_2");
  });

  it("leaves unrelated clicks alone", () => {
    document.body.innerHTML = `<button>Nothing</button>`;

    click("button");

    expect(launch.openNewCompose).not.toHaveBeenCalled();
    expect(launch.openReplyForArticle).not.toHaveBeenCalled();
    expect(launch.openEditForPost).not.toHaveBeenCalled();
  });
});
