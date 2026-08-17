/**
 * API Tokens Settings Page
 *
 * Manage Bearer tokens for programmatic API access.
 * Tokens are shown only once at creation — after that, only the prefix is visible.
 */

import { msg } from "@lingui/core/macro";
import { useLingui } from "../../../i18n/context.js";
import type { ApiToken } from "../../../types/entities.js";
import { buildConfirmActionExpression } from "../../../lib/confirm.js";
import { getJantDocsUrl } from "../../../lib/jant-docs.js";
import { formatDate } from "../../../lib/time.js";
import { toPublicPath } from "../../../lib/url.js";

const API_DOCS_URL = getJantDocsUrl("api");

function TokenRow({
  token,
  sitePathPrefix = "",
}: {
  token: ApiToken;
  sitePathPrefix?: string;
}) {
  const { i18n } = useLingui();
  const revokeLabel = i18n._(
    msg({
      message: "Revoke",
      comment: "@context: Button to revoke API token",
    }),
  );

  return (
    <div class="py-4 flex items-start gap-4 border-b border-border last:border-b-0">
      <div class="flex-1 min-w-0">
        <div class="font-medium">{token.name}</div>
        <div class="text-sm text-muted-foreground mt-0.5">
          <code class="text-xs bg-muted px-1.5 py-0.5 rounded">
            jnt_{token.prefix}...
          </code>
          <span class="mx-2">&middot;</span>
          {i18n._(
            msg({
              message: "Created {date}",
              comment: "@context: Token creation date",
            }),
            {
              date: formatDate(token.createdAt),
            },
          )}
          {token.lastUsedAt && (
            <>
              <span class="mx-2">&middot;</span>
              {i18n._(
                msg({
                  message: "Last used {date}",
                  comment: "@context: Token last used date",
                }),
                {
                  date: formatDate(token.lastUsedAt),
                },
              )}
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        class="btn-sm-ghost text-destructive"
        data-on:click__prevent={buildConfirmActionExpression(
          `@post('${toPublicPath(`/settings/api-tokens/${token.id}/delete`, sitePathPrefix)}')`,
          {
            message: i18n._(
              msg({
                message:
                  "Revoke this token? Any scripts using it will stop working.",
                comment: "@context: Confirm dialog for revoking API token",
              }),
            ),
            confirmLabel: revokeLabel,
            cancelLabel: i18n._(
              msg({
                message: "Cancel",
                comment: "@context: Button label to dismiss a dialog or action",
              }),
            ),
            tone: "danger",
          },
        )}
      >
        {revokeLabel}
      </button>
    </div>
  );
}

export function ApiTokensContent({
  tokens,
  siteUrl,
  sitePathPrefix = "",
}: {
  tokens: ApiToken[];
  siteUrl: string;
  sitePathPrefix?: string;
}) {
  const { i18n } = useLingui();

  return (
    <div
      class="flex flex-col gap-8 max-w-form"
      data-signals="{tokenName: '', _tokenLoading: false, _newPlaintext: '', _tokenCopied: false}"
    >
      {/* New token alert — shown after creation via signal patch */}
      <div data-show="$_newPlaintext" style="display:none">
        <div class="alert" role="alert">
          <strong>
            {i18n._(
              msg({
                message: "Copy your token now — it won't be shown again.",
                comment: "@context: Warning to copy newly created API token",
              }),
            )}
          </strong>
          <section class="mt-2">
            <div class="flex items-center gap-2">
              <code
                class="bg-muted px-3 py-2 rounded break-all select-all flex-1 text-sm"
                data-text="$_newPlaintext"
              >
                {" "}
              </code>
              <button
                type="button"
                class="btn-sm-outline shrink-0"
                data-on:click="navigator.clipboard.writeText($_newPlaintext); $_tokenCopied = true"
                data-text={`$_tokenCopied ? '${i18n._(msg({ message: "Copied", comment: "@context: Feedback after copying API token" }))}' : '${i18n._(msg({ message: "Copy Token", comment: "@context: Button to copy API token to clipboard" }))}'`}
              >
                {i18n._(
                  msg({
                    message: "Copy Token",
                    comment: "@context: Button to copy API token to clipboard",
                  }),
                )}
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Generate token form */}
      <div>
        <h2 class="text-lg font-medium mb-4">
          {i18n._(
            msg({
              message: "API Tokens",
              comment: "@context: Settings section heading",
            }),
          )}
        </h2>
        <p class="text-sm text-muted-foreground mb-4">
          {i18n._(
            msg({
              message:
                "Tokens let you access the API from scripts, shortcuts, and other tools without signing in.",
              comment: "@context: API tokens description",
            }),
          )}
        </p>
        <form
          data-on:submit__prevent={`@post('${toPublicPath("/settings/api-tokens", sitePathPrefix)}')`}
          data-indicator="_tokenLoading"
          class="flex gap-2 items-end"
        >
          <div class="field flex-1">
            <label class="label" for="tokenName">
              {i18n._(
                msg({
                  message: "Token name",
                  comment: "@context: API token name field label",
                }),
              )}
            </label>
            <input
              type="text"
              id="tokenName"
              data-bind="tokenName"
              class="input"
              placeholder={i18n._(
                msg({
                  message: "e.g. iOS Shortcuts",
                  comment: "@context: Placeholder for API token name input",
                }),
              )}
              required
            />
          </div>
          <button
            type="submit"
            class="btn"
            data-attr:disabled="$_tokenLoading || !$tokenName.trim()"
          >
            {i18n._(
              msg({
                message: "Generate Token",
                comment: "@context: Button to create new API token",
              }),
            )}
          </button>
        </form>
      </div>

      {/* Token list */}
      {tokens.length > 0 && (
        <div>
          <h3 class="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
            {i18n._(
              msg({
                message: "Active Tokens",
                comment: "@context: Heading for list of active API tokens",
              }),
            )}
          </h3>
          <div class="border border-border rounded-lg px-4">
            {tokens.map((token) => (
              <TokenRow
                key={token.id}
                token={token}
                sitePathPrefix={sitePathPrefix}
              />
            ))}
          </div>
        </div>
      )}

      {/* Usage examples */}
      <div>
        <h3 class="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
          {i18n._(
            msg({
              message: "Usage",
              comment: "@context: Heading for API token usage examples",
            }),
          )}
        </h3>
        <div class="flex flex-col gap-3 text-sm">
          <div>
            <div class="text-muted-foreground mb-1">
              {i18n._(
                msg({
                  message: "Create a post with curl:",
                  comment: "@context: Label for curl example",
                }),
              )}
            </div>
            <pre class="bg-muted px-3 py-2 rounded text-xs overflow-x-auto">
              <code>
                {`curl -X POST ${siteUrl}/api/posts \\
  -H "Authorization: Bearer jnt_YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"format":"note","body":"Hello from the API"}'`}
              </code>
            </pre>
          </div>
          <div>
            <div class="text-muted-foreground mb-1">
              {i18n._(
                msg({
                  message: "List posts:",
                  comment: "@context: Label for list posts curl example",
                }),
              )}
            </div>
            <pre class="bg-muted px-3 py-2 rounded text-xs overflow-x-auto">
              <code>
                {`curl ${siteUrl}/api/posts \\
  -H "Authorization: Bearer jnt_YOUR_TOKEN"`}
              </code>
            </pre>
          </div>
          <p class="text-muted-foreground">
            <a
              href={API_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              class="underline hover:text-foreground transition-colors"
            >
              {i18n._(
                msg({
                  message: "API reference",
                  comment: "@context: Link to API documentation",
                }),
              )}
            </a>
            {" — "}
            {i18n._(
              msg({
                message: "all available endpoints and request formats.",
                comment: "@context: Description after API reference link",
              }),
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
