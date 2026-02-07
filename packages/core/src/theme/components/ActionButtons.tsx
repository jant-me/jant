/**
 * Action Buttons Component
 *
 * Provides consistent Edit/View/Delete button group for list and detail pages
 */

import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/index.js";

export interface ActionButtonsProps {
  /**
   * URL for the edit action
   */
  editHref?: string;

  /**
   * URL for the view action (opens in new tab)
   */
  viewHref?: string;

  /**
   * Delete action URL (sends POST via Datastar @post)
   */
  deleteAction?: string;

  /**
   * Delete confirmation message
   */
  deleteConfirm?: string;

  /**
   * Button size variant
   * @default "sm"
   */
  size?: "sm" | "md";

  /**
   * Custom edit button label (overrides default translation)
   */
  editLabel?: string;

  /**
   * Custom view button label (overrides default translation)
   */
  viewLabel?: string;

  /**
   * Custom delete button label (overrides default translation)
   */
  deleteLabel?: string;
}

export const ActionButtons: FC<ActionButtonsProps> = ({
  editHref,
  viewHref,
  deleteAction,
  deleteConfirm,
  size = "sm",
  editLabel,
  viewLabel,
  deleteLabel,
}) => {
  const { t } = useLingui();

  const editClass = size === "sm" ? "btn-sm-outline" : "btn-outline";
  const viewClass = size === "sm" ? "btn-sm-ghost" : "btn-ghost";
  const deleteClass =
    size === "sm"
      ? "btn-sm-ghost text-destructive"
      : "btn-ghost text-destructive";

  const defaultEditLabel = t({
    message: "Edit",
    comment: "@context: Button to edit item",
  });
  const defaultViewLabel = t({
    message: "View",
    comment: "@context: Button to view item on public site",
  });
  const defaultDeleteLabel = t({
    message: "Delete",
    comment: "@context: Button to delete item",
  });

  const deleteClickHandler = deleteAction
    ? deleteConfirm
      ? `confirm('${deleteConfirm}') && @post('${deleteAction}')`
      : `@post('${deleteAction}')`
    : undefined;

  return (
    <>
      {editHref && (
        <a href={editHref} class={editClass}>
          {editLabel || defaultEditLabel}
        </a>
      )}
      {viewHref && (
        <a href={viewHref} class={viewClass} target="_blank">
          {viewLabel || defaultViewLabel}
        </a>
      )}
      {deleteAction && (
        <button
          type="button"
          class={deleteClass}
          data-on:click__prevent={deleteClickHandler}
        >
          {deleteLabel || defaultDeleteLabel}
        </button>
      )}
    </>
  );
};
