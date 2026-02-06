/**
 * CRUD Page Header Component
 *
 * Provides consistent header layout for dashboard CRUD list pages
 * with title and primary action button
 */

import type { FC, PropsWithChildren } from "hono/jsx";

export interface CrudPageHeaderProps extends PropsWithChildren {
  /**
   * Page title to display
   */
  title: string;

  /**
   * Primary action button text (e.g., "New Post")
   */
  ctaLabel?: string;

  /**
   * Primary action button href
   */
  ctaHref?: string;

  // children is already defined in PropsWithChildren
  // Optional children to render in place of default CTA button (useful for custom actions like upload buttons)
}

export const CrudPageHeader: FC<CrudPageHeaderProps> = ({ title, ctaLabel, ctaHref, children }) => {
  return (
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold">{title}</h1>
      {children ||
        (ctaLabel && ctaHref && (
          <a href={ctaHref} class="btn">
            {ctaLabel}
          </a>
        ))}
    </div>
  );
};
