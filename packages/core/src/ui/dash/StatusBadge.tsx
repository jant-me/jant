/**
 * Status Badge Component
 *
 * Displays badges for post status, visibility, and pinned state.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { Status, Visibility } from "../../types.js";

export interface StatusBadgeProps {
  status: Status;
  visibility?: Visibility;
  featured?: boolean;
  pinned?: boolean;
}

export const StatusBadge: FC<StatusBadgeProps> = ({
  status,
  visibility,
  featured,
  pinned,
}) => {
  const { i18n } = useLingui();

  const statusVariants: Record<Status, string> = {
    published: "badge-secondary",
    draft: "badge-outline",
  };

  const statusLabels: Record<Status, string> = {
    published: i18n._(
      msg({
        message: "Published",
        comment: "@context: Post status badge - published",
      }),
    ),
    draft: i18n._(
      msg({
        message: "Draft",
        comment: "@context: Post status badge - draft",
      }),
    ),
  };

  return (
    <span class="flex items-center gap-1">
      <span class={statusVariants[status]}>{statusLabels[status]}</span>
      {featured && (
        <span class="badge-primary">
          {i18n._(
            msg({
              message: "Featured",
              comment: "@context: Post badge - featured",
            }),
          )}
        </span>
      )}
      {visibility === "latest_hidden" && (
        <span class="badge-outline">
          {i18n._(
            msg({
              message: "Hidden from Latest",
              comment: "@context: Post badge for posts hidden from Latest",
            }),
          )}
        </span>
      )}
      {visibility === "unlisted" && (
        <span class="badge-outline">
          {i18n._(
            msg({
              message: "Unlisted",
              comment:
                "@context: Post badge for posts that open for anyone with the link but are listed nowhere",
            }),
          )}
        </span>
      )}
      {pinned && (
        <span class="badge-outline">
          {i18n._(
            msg({
              message: "Pinned",
              comment: "@context: Post badge - pinned",
            }),
          )}
        </span>
      )}
    </span>
  );
};
