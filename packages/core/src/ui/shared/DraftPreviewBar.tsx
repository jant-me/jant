import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";

interface DraftPreviewBarProps {
  editHref: string;
}

/** Persistent page chrome that distinguishes an authenticated draft preview. */
export const DraftPreviewBar: FC<DraftPreviewBarProps> = ({ editHref }) => {
  const { i18n } = useLingui();
  const label = i18n._(
    msg({
      message: "Draft preview",
      comment: "@context: Status label above a draft preview page",
    }),
  );

  return (
    <aside class="draft-preview-bar" aria-label={label} data-preview-status>
      <div class="draft-preview-bar-inner">
        <div class="draft-preview-bar-copy">
          <span class="draft-preview-bar-label">
            <span class="draft-preview-bar-dot" aria-hidden="true" />
            {label}
          </span>
          <span class="draft-preview-bar-description">
            {i18n._(
              msg({
                message: "This post isn’t published.",
                comment:
                  "@context: Explanation in the draft preview status bar",
              }),
            )}
          </span>
        </div>
        <a class="draft-preview-bar-action" href={editHref}>
          {i18n._(
            msg({
              message: "Edit draft",
              comment:
                "@context: Action in the draft preview status bar that opens the editor",
            }),
          )}
        </a>
      </div>
    </aside>
  );
};
