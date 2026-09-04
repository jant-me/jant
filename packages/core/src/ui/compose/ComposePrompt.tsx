/**
 * Compose Prompt
 *
 * "What's new?" prompt bar at the top of the content area.
 * Clicking it opens the compose dialog.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";

interface ComposePromptProps {
  composeOpenShortcutDiscovered?: boolean;
}

export const ComposePrompt: FC<ComposePromptProps> = ({
  composeOpenShortcutDiscovered = false,
}) => {
  const { i18n } = useLingui();

  return (
    <div
      class="compose-prompt"
      data-compose-open-shortcut-discovered={
        composeOpenShortcutDiscovered ? "true" : "false"
      }
    >
      <button type="button" class="compose-prompt-trigger" data-compose-open>
        <span class="compose-prompt-avatar">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
            <line x1="16" y1="8" x2="2" y2="22" />
            <line x1="17.5" y1="15" x2="9" y2="15" />
          </svg>
        </span>
        <span class="compose-prompt-text">
          {i18n._(
            msg({
              message: "What's on your mind?",
              comment: "@context: Compose prompt placeholder text",
            }),
          )}
        </span>
      </button>
      <span class="compose-prompt-discovery-hint" aria-hidden="true">
        {i18n._(
          msg({
            message: "Press N to write",
            comment: "@context: Hover hint for the homepage compose shortcut",
          }),
        )}
      </span>
    </div>
  );
};
