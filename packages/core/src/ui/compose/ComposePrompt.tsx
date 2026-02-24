/**
 * Compose Prompt
 *
 * "What's new?" prompt bar at the top of the content area.
 * Clicking it opens the compose dialog.
 */

import type { FC } from "hono/jsx";
import { useLingui } from "@lingui/react/macro";

export const ComposePrompt: FC = () => {
  const { t } = useLingui();

  return (
    <div class="compose-prompt">
      <button
        type="button"
        class="compose-prompt-trigger"
        onclick="const d=document.getElementById('compose-dialog');d.showModal();d.querySelector('jant-compose-editor')?.focusInput()"
      >
        <span class="compose-prompt-avatar">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
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
          {t({
            message: "What's on your mind?",
            comment: "@context: Compose prompt placeholder text",
          })}
        </span>
      </button>
      <button
        type="button"
        class="compose-prompt-post-btn"
        onclick="const d=document.getElementById('compose-dialog');d.showModal();d.querySelector('jant-compose-editor')?.focusInput()"
      >
        {t({
          message: "Post",
          comment: "@context: Compose prompt post button",
        })}
      </button>
    </div>
  );
};
