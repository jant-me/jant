/**
 * MCP OAuth 2.1 Authorization & Consent Route (`/_/oauth/authorize`)
 *
 * Lives under Jant's reserved `/_/` prefix so it never collides with author
 * content URLs, and is discovered automatically via
 * `/.well-known/oauth-authorization-server`.
 */

import { Hono, type Context } from "hono";
import type { FC } from "hono/jsx";
import { msg } from "@lingui/core/macro";
import { useLingui } from "../../i18n/context.js";
import { getI18n } from "../../i18n/index.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuth } from "../../middleware/auth.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { toPublicPath } from "../../lib/url.js";
import { BaseLayout } from "../../ui/layouts/BaseLayout.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const oauthAuthorizeRoutes = new Hono<Env>();

interface ConsentPageProps {
  siteName: string;
  clientName: string;
  redirectHost: string;
  actionHref: string;
  csrfToken: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope: string;
}

const OAuthConsentPage: FC<ConsentPageProps> = ({
  siteName,
  clientName,
  redirectHost,
  actionHref,
  csrfToken,
  clientId,
  redirectUri,
  codeChallenge,
  state,
  scope,
}) => {
  const { i18n } = useLingui();

  return (
    <main class="min-h-screen flex items-center justify-center px-4 py-12">
      <div class="card w-full max-w-md">
        <header>
          <h1 class="text-xl font-semibold">
            {i18n._(
              msg({
                message: "Authorize {clientName}",
                comment: "@context: OAuth consent heading",
              }),
              { clientName },
            )}
          </h1>
          <p class="text-sm text-muted-foreground mt-1">
            {i18n._(
              msg({
                message:
                  "{clientName} is requesting MCP access to manage {siteName}.",
                comment: "@context: OAuth consent description",
              }),
              { clientName, siteName },
            )}
          </p>
        </header>
        <section class="space-y-4">
          <div class="text-sm space-y-2 text-muted-foreground">
            <p>
              {i18n._(
                msg({
                  message:
                    "Approving creates a revocable API token that lets this client read, publish, edit, and organize posts, Collections, media, and settings.",
                  comment: "@context: OAuth permission summary",
                }),
              )}
            </p>
            <p class="text-xs">
              {i18n._(
                msg({
                  message:
                    "Redirect destination: {redirectHost}. You can revoke access at any time in Settings → API Tokens.",
                  comment: "@context: OAuth redirect and revocation notice",
                }),
                { redirectHost },
              )}
            </p>
          </div>
          <form method="post" action={actionHref} class="flex gap-3 pt-2">
            <input type="hidden" name="csrf_token" value={csrfToken} />
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="code_challenge" value={codeChallenge} />
            <input type="hidden" name="code_challenge_method" value="S256" />
            <input type="hidden" name="state" value={state} />
            <input type="hidden" name="scope" value={scope} />
            <button
              type="submit"
              name="decision"
              value="approve"
              class="btn flex-1"
            >
              {i18n._(
                msg({
                  message: "Approve",
                  comment: "@context: OAuth approve button",
                }),
              )}
            </button>
            <button
              type="submit"
              name="decision"
              value="deny"
              class="btn-outline flex-1"
            >
              {i18n._(
                msg({
                  message: "Deny",
                  comment: "@context: OAuth deny button",
                }),
              )}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
};

interface ValidatedAuthorizeRequest {
  client: { id: string; name: string; redirectUris: string[] };
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope: string;
}

async function validateAuthorizeParams(
  c: Context<Env>,
  params: {
    responseType: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    state: string;
    scope: string;
  },
): Promise<
  { ok: true; data: ValidatedAuthorizeRequest } | { ok: false; error: string }
> {
  if (!params.clientId) {
    return { ok: false, error: "Missing client_id." };
  }
  const client = await c.var.services.oauth.getClient(params.clientId);
  if (!client) {
    return { ok: false, error: "Unknown client_id." };
  }
  if (
    !params.redirectUri ||
    !client.redirectUris.includes(params.redirectUri)
  ) {
    return {
      ok: false,
      error: "redirect_uri does not match registered client.",
    };
  }
  if (params.responseType && params.responseType !== "code") {
    return { ok: false, error: "Only response_type=code is supported." };
  }
  if (!params.codeChallenge || params.codeChallengeMethod !== "S256") {
    return {
      ok: false,
      error: "PKCE with code_challenge_method=S256 is required.",
    };
  }

  return {
    ok: true,
    data: {
      client,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scope: params.scope.trim() || "mcp",
    },
  };
}

function appendRedirectParams(
  redirectUri: string,
  params: Record<string, string>,
): string {
  const target = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) target.searchParams.set(key, value);
  }
  return target.toString();
}

function describeRedirectTarget(redirectUri: string): string {
  try {
    const parsed = new URL(redirectUri);
    return parsed.host || parsed.protocol;
  } catch {
    return redirectUri;
  }
}

oauthAuthorizeRoutes.use("/oauth/authorize", requireAuth());

oauthAuthorizeRoutes.get("/oauth/authorize", async (c) => {
  const validated = await validateAuthorizeParams(c, {
    responseType: c.req.query("response_type") ?? "",
    clientId: c.req.query("client_id") ?? "",
    redirectUri: c.req.query("redirect_uri") ?? "",
    codeChallenge: c.req.query("code_challenge") ?? "",
    codeChallengeMethod: c.req.query("code_challenge_method") ?? "",
    state: c.req.query("state") ?? "",
    scope: c.req.query("scope") ?? "mcp",
  });

  if (!validated.ok) {
    return c.text(validated.error, 400);
  }

  const sessionId = c.var.session?.session.id;
  if (!sessionId) {
    return c.text("Session required.", 401);
  }

  const csrfToken =
    await c.var.services.oauth.generateConsentCsrfToken(sessionId);
  const { appConfig } = c.var;
  const i18n = getI18n(c);
  const title = buildPageTitle(
    i18n._(
      msg({
        message: "Authorize MCP Access",
        comment: "@context: OAuth consent browser title",
      }),
    ),
    appConfig.siteName,
  );
  const actionHref = toPublicPath(
    "/_/oauth/authorize",
    appConfig.sitePathPrefix,
  );

  c.header("Cache-Control", "no-store");
  return c.html(
    <BaseLayout title={title} c={c} noindex isAuthenticated>
      <OAuthConsentPage
        siteName={appConfig.siteName}
        clientName={validated.data.client.name}
        redirectHost={describeRedirectTarget(validated.data.redirectUri)}
        actionHref={actionHref}
        csrfToken={csrfToken}
        clientId={validated.data.client.id}
        redirectUri={validated.data.redirectUri}
        codeChallenge={validated.data.codeChallenge}
        state={validated.data.state}
        scope={validated.data.scope}
      />
    </BaseLayout>,
  );
});

oauthAuthorizeRoutes.post("/oauth/authorize", async (c) => {
  const form = await c.req.parseBody();
  const str = (key: string) => {
    const val = form[key];
    return typeof val === "string" ? val : "";
  };

  const session = c.var.session;
  if (!session?.session.id || !session.user.id) {
    return c.text("Session required.", 401);
  }

  const csrfValid = await c.var.services.oauth.verifyConsentCsrfToken(
    session.session.id,
    str("csrf_token"),
  );
  if (!csrfValid) {
    return c.text("Invalid CSRF token. Please retry authorization.", 403);
  }

  const validated = await validateAuthorizeParams(c, {
    responseType: "code",
    clientId: str("client_id"),
    redirectUri: str("redirect_uri"),
    codeChallenge: str("code_challenge"),
    codeChallengeMethod: str("code_challenge_method"),
    state: str("state"),
    scope: str("scope") || "mcp",
  });

  if (!validated.ok) {
    return c.text(validated.error, 400);
  }

  const { client, redirectUri, codeChallenge, state, scope } = validated.data;

  if (str("decision") !== "approve") {
    return c.redirect(
      appendRedirectParams(redirectUri, {
        error: "access_denied",
        ...(state ? { state } : {}),
      }),
      302,
    );
  }

  const code = await c.var.services.oauth.createAuthorizationCode({
    clientId: client.id,
    userId: session.user.id,
    redirectUri,
    codeChallenge,
    scope,
  });

  return c.redirect(
    appendRedirectParams(redirectUri, {
      code,
      ...(state ? { state } : {}),
    }),
    302,
  );
});
