/**
 * Post Status Badges
 *
 * Renders top-of-card status indicators that should stay visually prominent.
 * All badges are always rendered in the DOM; visibility is driven by CSS
 * selectors on the parent article's data attributes. This lets the post menu
 * toggle badges instantly without a page reload. Featured is rendered in the
 * footer meta instead.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import { Icon } from "../shared/Icon.js";

export const PostStatusBadges: FC = () => {
  const { i18n } = useLingui();

  const pinnedLabel = i18n._(
    msg({
      message: "Pinned",
      comment: "@context: Post status badge for a pinned post",
    }),
  );

  return (
    <div class="post-status-badges">
      <span class="post-status-badge post-status-pinned">
        <Icon name="post-status-pin" />
        {pinnedLabel}
      </span>
      <span class="post-status-badge post-status-pinned-in-collection">
        <Icon name="post-status-pin" />
        {pinnedLabel}
      </span>
      <span class="post-status-badge post-status-private">
        <Icon name="post-status-private" />
        {i18n._(
          msg({
            message: "Private",
            comment: "@context: Post status badge for a private post",
          }),
        )}
      </span>
      {/* The one badge that is also a control: a draft's most likely next
          action is "finish it", so the label itself opens the editor. */}
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
    </div>
  );
};
