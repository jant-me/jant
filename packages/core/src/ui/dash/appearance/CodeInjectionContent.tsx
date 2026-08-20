/**
 * Code Injection — site-wide HTML in <head> and at end of <body>.
 *
 * For analytics scripts, chat widgets, custom meta tags, and any third-party
 * snippet that needs to load on every page. Author-only, deliberately
 * unsanitized — the warning copy makes the security boundary explicit.
 */

import { msg } from "@lingui/core/macro";
import { useLingui } from "../../../i18n/context.js";
import { toPublicPath } from "../../../lib/url.js";

export function CodeInjectionContent({
  customHeadHtml,
  customBodyEndHtml,
  sitePathPrefix = "",
}: {
  customHeadHtml: string;
  customBodyEndHtml: string;
  sitePathPrefix?: string;
}) {
  const { i18n } = useLingui();

  const signals = JSON.stringify({
    customHeadHtml,
    customBodyEndHtml,
  }).replace(/</g, "\\u003c");

  return (
    <form
      data-signals={signals}
      data-on:submit__prevent={`@post('${toPublicPath("/settings/code-injection", sitePathPrefix)}')`}
      data-indicator="_codeLoading"
      class="max-w-form"
    >
      <div role="note" class="alert-destructive mb-6">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 9v4" />
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 17h.01" />
        </svg>
        <strong>
          {i18n._(
            msg({
              message: "This code runs on every page of your site.",
              comment: "@context: Code Injection security warning headline",
            }),
          )}
        </strong>
        <section>
          <p>
            {i18n._(
              msg({
                message:
                  "Anything you paste here has full access to your visitors' browsers. Only use code from sources you trust.",
                comment: "@context: Code Injection security warning body",
              }),
            )}
          </p>
        </section>
      </div>

      <fieldset class="mb-6">
        <legend class="text-lg font-semibold">
          {i18n._(
            msg({
              message: "Site Header",
              comment: "@context: Code Injection field group label for <head>",
            }),
          )}
        </legend>
        <p class="text-sm text-muted-foreground mb-4">
          {i18n._(
            msg({
              message:
                "Injected before </head>. Use for analytics, custom meta tags, and styles that must load early.",
              comment: "@context: Code Injection head field description",
            }),
          )}
        </p>
        <textarea
          data-bind="customHeadHtml"
          class="textarea font-mono text-sm min-h-32"
          rows={8}
          placeholder={
            '<script defer src="https://plausible.io/js/script.js" data-domain="example.com"></script>'
          }
        >
          {customHeadHtml}
        </textarea>
      </fieldset>

      <fieldset class="mb-6">
        <legend class="text-lg font-semibold">
          {i18n._(
            msg({
              message: "Site Footer",
              comment:
                "@context: Code Injection field group label for body end",
            }),
          )}
        </legend>
        <p class="text-sm text-muted-foreground mb-4">
          {i18n._(
            msg({
              message:
                "Injected before </body>. Use for chat widgets and scripts that should not block page load.",
              comment: "@context: Code Injection body-end field description",
            }),
          )}
        </p>
        <textarea
          data-bind="customBodyEndHtml"
          class="textarea font-mono text-sm min-h-32"
          rows={8}
          placeholder={
            '<script data-letterbirduser="you" src="https://letterbird.co/embed/v1.js"></script>'
          }
        >
          {customBodyEndHtml}
        </textarea>
      </fieldset>

      <button type="submit" class="btn" data-attr:disabled="$_codeLoading">
        <svg
          data-show="$_codeLoading"
          style="display:none"
          class="animate-spin size-4"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          role="status"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        {i18n._(
          msg({
            message: "Save",
            comment: "@context: Button to save Code Injection settings",
          }),
        )}
      </button>
    </form>
  );
}
