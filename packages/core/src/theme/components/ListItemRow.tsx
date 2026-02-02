/**
 * List Item Row Component
 *
 * Provides consistent layout for list items in dashboard CRUD pages.
 * Handles responsive spacing, overflow, and action button placement.
 */

import type { FC, PropsWithChildren } from "hono/jsx";

export interface ListItemRowProps extends PropsWithChildren {
  /**
   * Action buttons to display on the right side
   */
  actions?: unknown;
}

export const ListItemRow: FC<ListItemRowProps> = ({ children, actions }) => {
  return (
    <div class="py-4 flex items-start gap-4">
      <div class="flex-1 min-w-0">{children}</div>
      {actions && <div class="flex items-center gap-2">{actions}</div>}
    </div>
  );
};
