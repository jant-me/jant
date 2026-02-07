/**
 * Type Badge Component
 *
 * Displays a badge indicating the type of a post (note, article, link, etc.)
 */

import type { FC } from "hono/jsx";
import { useLingui } from "@lingui/react/macro";
import type { PostType } from "../../types.js";

export interface TypeBadgeProps {
  type: PostType;
}

export const TypeBadge: FC<TypeBadgeProps> = ({ type }) => {
  const { t } = useLingui();

  const labels: Record<PostType, string> = {
    note: t({ message: "Note", comment: "@context: Post type badge - note" }),
    article: t({
      message: "Article",
      comment: "@context: Post type badge - article",
    }),
    link: t({ message: "Link", comment: "@context: Post type badge - link" }),
    quote: t({
      message: "Quote",
      comment: "@context: Post type badge - quote",
    }),
    image: t({
      message: "Image",
      comment: "@context: Post type badge - image",
    }),
    page: t({ message: "Page", comment: "@context: Post type badge - page" }),
  };

  return <span class="badge-outline">{labels[type]}</span>;
};
