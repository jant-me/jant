/**
 * Post Status Badges
 *
 * Renders top-of-card status indicators that should stay visually prominent.
 * Visibility is driven by CSS selectors on the parent article's data
 * attributes, so for the signed-in author every badge ships in the DOM whether
 * or not it currently applies: the post menu toggles `data-post-pinned` and
 * friends on the article, and the matching badge appears without a reload.
 *
 * An anonymous reader has no menu and cannot change any of that, and never
 * receives a draft or private post to begin with, so the same card would carry
 * four permanently invisible badges. There we emit only the badges that
 * actually apply — usually none at all. Featured is rendered in the footer
 * meta instead.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import { useViewer } from "../../lib/viewer-context.js";
import type { PostView } from "../../types.js";
import { Icon } from "../shared/Icon.js";

type PostStatusBadgeSource = Pick<
  PostView,
  "status" | "visibility" | "pinned" | "pinnedInCollection"
>;

export const PostStatusBadges: FC<{ post: PostStatusBadgeSource }> = ({
  post,
}) => {
  const { i18n } = useLingui();
  const { isAuthor } = useViewer();

  const isPinned = post.pinned;
  const isPinnedInCollection = Boolean(post.pinnedInCollection);
  const isPrivate = post.visibility === "private";
  const isDraft = post.status === "draft";

  // The author's card keeps every badge so the menu can reveal one instantly.
  // A reader's card carries only what is true right now, and nothing when the
  // post has no status to announce.
  if (
    !isAuthor &&
    !isPinned &&
    !isPinnedInCollection &&
    !isPrivate &&
    !isDraft
  ) {
    return null;
  }

  const showPinned = isAuthor || isPinned;
  const showPinnedInCollection = isAuthor || isPinnedInCollection;
  const showPrivate = isAuthor || isPrivate;
  const showDraft = isAuthor || isDraft;

  const pinnedLabel = i18n._(
    msg({
      message: "Pinned",
      comment: "@context: Post status badge for a pinned post",
    }),
  );

  return (
    <div class="post-status-badges">
      {showPinned && (
        <span class="post-status-badge post-status-pinned">
          <Icon name="post-status-pin" />
          {pinnedLabel}
        </span>
      )}
      {showPinnedInCollection && (
        <span class="post-status-badge post-status-pinned-in-collection">
          <Icon name="post-status-pin" />
          {pinnedLabel}
        </span>
      )}
      {showPrivate && (
        <span class="post-status-badge post-status-private">
          <Icon name="post-status-private" />
          {i18n._(
            msg({
              message: "Private",
              comment: "@context: Post status badge for a private post",
            }),
          )}
        </span>
      )}
      {/* The one badge that is also a control: a draft's most likely next
          action is "finish it", so the label itself opens the editor. */}
      {showDraft && (
        <button
          type="button"
          class="post-status-badge post-status-draft"
          data-draft-continue
          title={i18n._(
            msg({
              message: "Continue writing this draft",
              comment:
                "@context: Tooltip on the draft badge, which opens the editor",
            }),
          )}
        >
          <Icon name="post-status-draft" />
          {i18n._(
            msg({
              message: "Draft",
              comment:
                "@context: Post status badge for an unpublished draft, shown to the author only",
            }),
          )}
        </button>
      )}
    </div>
  );
};
