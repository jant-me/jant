import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { Collection } from "../../types.js";
import { ComposeForm } from "../compose/ComposeDialog.js";

export interface ComposePageProps {
  collections?: Collection[];
  uploadMaxFileSize?: number;
  closeHref?: string;
  slashCommandDiscovered?: boolean;
  /** Languages offered in the composer. Empty on a single-language site. */
  languages?: Array<{ tag: string; label: string }>;
  /** Content language the composer's automatic choice defaults to. */
  contextLanguage?: string | null;
}

export const ComposePage: FC<ComposePageProps> = ({
  collections,
  uploadMaxFileSize,
  closeHref = "/",
  slashCommandDiscovered = false,
  languages,
  contextLanguage,
}) => {
  const { i18n } = useLingui();
  const backLabel = i18n._(
    msg({
      message: "Back",
      comment: "@context: Link back from the new post page",
    }),
  );

  return (
    <section class="compose-page" data-page="compose">
      <div class="compose-page-shell">
        <div class="compose-page-intro">
          <div class="compose-page-intro-row">
            <h1 class="compose-page-title">
              {i18n._(
                msg({
                  message: "New post",
                  comment: "@context: Page title for the new post page",
                }),
              )}
            </h1>
            <button
              type="button"
              class="compose-page-back-link"
              aria-label={backLabel}
              data-on:click="el.closest('.compose-page-shell')?.querySelector('jant-compose-dialog')?.requestCloseAndLeave()"
            >
              <span>{`← ${backLabel}`}</span>
            </button>
          </div>
        </div>
        <ComposeForm
          collections={collections}
          uploadMaxFileSize={uploadMaxFileSize}
          pageMode
          closeHref={closeHref}
          autoRestoreDraft
          slashCommandDiscovered={slashCommandDiscovered}
          languages={languages}
          contextLanguage={contextLanguage}
        />
      </div>
    </section>
  );
};
