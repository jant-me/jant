/**
 * Visibility Badge Component
 *
 * Displays a badge indicating the visibility level of a post
 */

import type { FC } from "hono/jsx";
import { useLingui } from "@lingui/react/macro";
import type { Visibility } from "../../types.js";

export interface VisibilityBadgeProps {
  visibility: Visibility;
}

export const VisibilityBadge: FC<VisibilityBadgeProps> = ({ visibility }) => {
  const { t } = useLingui();

  const variants: Record<Visibility, string> = {
    featured: "badge-primary",
    quiet: "badge-secondary",
    unlisted: "badge-outline",
    draft: "badge-outline",
  };

  const labels: Record<Visibility, string> = {
    featured: t({
      message: "Featured",
      comment: "@context: Post visibility badge - featured",
    }),
    quiet: t({
      message: "Quiet",
      comment: "@context: Post visibility badge - normal",
    }),
    unlisted: t({
      message: "Unlisted",
      comment: "@context: Post visibility badge - unlisted",
    }),
    draft: t({
      message: "Draft",
      comment: "@context: Post visibility badge - draft",
    }),
  };

  return <span class={variants[visibility]}>{labels[visibility]}</span>;
};
