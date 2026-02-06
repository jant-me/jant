/**
 * Empty State Component
 *
 * Displays a message when a list or collection has no items,
 * optionally with a call-to-action button
 */

import type { FC } from "hono/jsx";

export interface EmptyStateProps {
  /**
   * Message to display when empty
   */
  message: string;

  /**
   * Optional call-to-action button text
   */
  ctaText?: string;

  /**
   * Optional call-to-action button href
   */
  ctaHref?: string;

  /**
   * Whether to center the content with padding (default: true)
   */
  centered?: boolean;
}

export const EmptyState: FC<EmptyStateProps> = ({
  message,
  ctaText,
  ctaHref,
  centered = true,
}) => {
  if (!centered) {
    return <p class="text-muted-foreground">{message}</p>;
  }

  return (
    <div class="text-center py-12 text-muted-foreground">
      <p>{message}</p>
      {ctaText && ctaHref && (
        <a href={ctaHref} class="btn mt-4">
          {ctaText}
        </a>
      )}
    </div>
  );
};
