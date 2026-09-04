/**
 * Server-rendered buttons that open the composer.
 *
 * The composer ships in its own bundle, loaded on first use, so markup the
 * server renders must not call the element directly: an unupgraded
 * `<jant-compose-dialog>` has no methods yet. Buttons carry a data attribute
 * instead, and this module — always on a signed-in page — turns the click
 * into a call through `compose-launch.ts`, which loads the bundle first.
 *
 * - `[data-compose-open]`, with an optional `data-compose-collection-id`:
 *   start a new post
 * - `[data-reply-trigger]` inside `article[data-post]`: reply to that post
 * - `[data-draft-continue]`: reopen an inline draft in the editor
 */

import {
  openEditForPost,
  openNewCompose,
  openReplyForArticle,
} from "./compose-launch.js";

document.addEventListener("click", (event: MouseEvent) => {
  const origin =
    event.target instanceof globalThis.Element ? event.target : null;
  if (!origin) return;

  const composeOpen = origin.closest<HTMLElement>("[data-compose-open]");
  if (composeOpen) {
    const collectionId = composeOpen.dataset.composeCollectionId;
    void openNewCompose(collectionId ? { collectionId } : undefined);
    return;
  }

  const replyTrigger = origin.closest<HTMLElement>("[data-reply-trigger]");
  if (replyTrigger) {
    const article = replyTrigger.closest<HTMLElement>("article[data-post]");
    if (article) void openReplyForArticle(article);
    return;
  }

  // The badge on an inline draft doubles as its most likely next action.
  // Publish and Delete live in the post menu with every other post action.
  const draftContinue = origin.closest<HTMLElement>("[data-draft-continue]");
  if (draftContinue) {
    const postId =
      draftContinue.dataset.postId ??
      draftContinue.closest<HTMLElement>("article[data-post]")?.dataset.postId;
    if (postId) void openEditForPost(postId);
  }
});
