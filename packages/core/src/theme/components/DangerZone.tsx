/**
 * Danger Zone Component
 *
 * Displays a section for destructive actions (like delete) with
 * consistent styling and confirmation prompts
 */

import type { FC, PropsWithChildren } from "hono/jsx";
import { useLingui } from "../../i18n/index.js";

export interface DangerZoneProps extends PropsWithChildren {
  /**
   * Title for the danger zone section
   * @default "Danger Zone"
   */
  title?: string;

  /**
   * Optional description or warning text
   */
  description?: string;

  /**
   * Label for the destructive action button
   */
  actionLabel: string;

  /**
   * Form action URL for the destructive operation
   */
  formAction: string;

  /**
   * Confirmation message to show before executing action
   */
  confirmMessage?: string;

  /**
   * Whether the action button should be disabled
   */
  disabled?: boolean;
}

export const DangerZone: FC<DangerZoneProps> = ({
  title,
  description,
  actionLabel,
  formAction,
  confirmMessage,
  disabled = false,
  children,
}) => {
  const { t } = useLingui();

  const defaultTitle = t({
    message: "Danger Zone",
    comment: "@context: Section heading for dangerous/destructive actions",
  });

  const clickHandler = confirmMessage
    ? `confirm('${confirmMessage}') && @post('${formAction}')`
    : `@post('${formAction}')`;

  return (
    <div class="mt-8 pt-8 border-t">
      <h2 class="text-lg font-medium text-destructive mb-4">
        {title || defaultTitle}
      </h2>
      {description && (
        <p class="text-sm text-muted-foreground mb-4">{description}</p>
      )}
      {children}
      <button
        type="button"
        class="btn-destructive"
        disabled={disabled}
        data-on:click__prevent={clickHandler}
      >
        {actionLabel}
      </button>
    </div>
  );
};
