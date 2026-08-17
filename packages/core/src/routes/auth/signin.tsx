/**
 * Sign-in / Sign-out Routes
 */

import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { msg } from "@lingui/core/macro";
import { useLingui } from "../../i18n/context.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { BaseLayout } from "../../ui/layouts/BaseLayout.js";
import { dsRedirect, dsToast } from "../../lib/sse.js";
import { SigninSchema } from "../../lib/schemas.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { getI18n } from "../../i18n/index.js";
import { getHostedControlPlaneSigninUrl } from "../../lib/hosted-signin.js";
import { isCurrentSiteMember } from "../../middleware/auth.js";
import { isSafeInternalRedirect, toPublicPath } from "../../lib/url.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const SigninContent: FC<{
  demoEmail?: string;
  demoPassword?: string;
  sitePathPrefix?: string;
  redirect?: string;
}> = ({ demoEmail, demoPassword, sitePathPrefix = "", redirect }) => {
  const { i18n } = useLingui();
  const signals = JSON.stringify({
    email: demoEmail || "",
    password: demoPassword || "",
    ...(redirect ? { redirect } : {}),
  }).replace(/</g, "\\u003c");

  return (
    <div class="min-h-screen flex items-center justify-center">
      <div class="card max-w-md w-full">
        <header>
          <h2>
            {i18n._(
              msg({
                message: "Sign In",
                comment: "@context: Sign in page heading",
              }),
            )}
          </h2>
        </header>
        <section>
          {demoEmail && demoPassword && (
            <p class="text-muted-foreground text-sm mb-4">
              {i18n._(
                msg({
                  message:
                    "Demo credentials are pre-filled — hit Sign In to continue.",
                  comment:
                    "@context: Hint shown on signin page when demo credentials are pre-filled",
                }),
              )}
            </p>
          )}
          <form
            data-signals={signals}
            data-on:submit__prevent={`@post('${toPublicPath("/signin", sitePathPrefix)}')`}
            data-indicator="_loading"
            class="flex flex-col gap-4"
          >
            <div class="field">
              <label class="label">
                {i18n._(
                  msg({
                    message: "Email",
                    comment: "@context: Setup/signin form field - email",
                  }),
                )}
              </label>
              <input type="email" data-bind="email" class="input" required />
            </div>
            <div class="field">
              <label class="label">
                {i18n._(
                  msg({
                    message: "Password",
                    comment: "@context: Setup/signin form field - password",
                  }),
                )}
              </label>
              <input
                type="password"
                data-bind="password"
                class="input"
                required
              />
            </div>
            <button type="submit" class="btn" data-attr:disabled="$_loading">
              <svg
                data-show="$_loading"
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
                  message: "Sign In",
                  comment: "@context: Sign in form submit button",
                }),
              )}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};

export const signinRoutes = new Hono<Env>();

signinRoutes.get("/signin", async (c) => {
  const rawRedirect = c.req.query("redirect");
  const redirect = isSafeInternalRedirect(rawRedirect)
    ? rawRedirect
    : undefined;

  // Membership, not merely a session: `requireAuth` sends non-members here, so
  // reading `isAuthenticated` instead would send them straight back and the two
  // would volley until the browser refused to follow another hop.
  if (await isCurrentSiteMember(c)) {
    return c.redirect(
      toPublicPath(redirect ?? "/", c.var.appConfig.sitePathPrefix),
    );
  }

  const hostedSigninUrl = getHostedControlPlaneSigninUrl(
    c.env,
    c.var.publicRequestUrl,
    redirect,
  );
  if (hostedSigninUrl) {
    return c.redirect(hostedSigninUrl);
  }

  const i18n = getI18n(c);
  const isSetup = c.req.query("setup") !== undefined;
  const isReset = c.req.query("reset") !== undefined;
  let toast: { message: string } | undefined;
  if (isSetup) {
    toast = { message: "Account created. Sign in to get started." };
  } else if (isReset) {
    toast = { message: "Password reset. Sign in with your new password." };
  }

  return c.html(
    <BaseLayout
      title={buildPageTitle(
        i18n._(
          msg({
            message: "Sign In",
            comment: "@context: Sign in page heading",
          }),
        ),
        c.var.appConfig.siteName,
      )}
      c={c}
      toast={toast}
    >
      <SigninContent
        demoEmail={c.var.appConfig.demoEmail}
        demoPassword={c.var.appConfig.demoPassword}
        sitePathPrefix={c.var.appConfig.sitePathPrefix}
        redirect={redirect}
      />
    </BaseLayout>,
  );
});

signinRoutes.post("/signin", async (c) => {
  const i18n = getI18n(c);

  if (!c.var.auth) {
    return dsToast(
      i18n._(
        msg({
          message: "Authentication isn't set up. Check your server config.",
          comment:
            "@context: Error toast when authentication system is unavailable",
        }),
      ),
      "error",
    );
  }

  const body = await c.req.json();
  const parsed = SigninSchema.safeParse(body);

  if (!parsed.success) {
    const errorMsg =
      parsed.error.issues[0]?.message ??
      i18n._(
        msg({
          message:
            "Something doesn't look right. Check the form and try again.",
          comment: "@context: Fallback validation error for sign-in form",
        }),
      );
    return dsToast(errorMsg, "error");
  }

  const { email, password } = parsed.data;
  const rawRedirect =
    body && typeof body === "object" && "redirect" in body
      ? (body as { redirect?: unknown }).redirect
      : undefined;
  const redirectTarget =
    typeof rawRedirect === "string" && isSafeInternalRedirect(rawRedirect)
      ? rawRedirect
      : "/";

  try {
    const { headers } = await c.var.auth.api.signInEmail({
      returnHeaders: true,
      body: { email, password },
      headers: c.req.raw.headers,
    });

    return dsRedirect(
      toPublicPath(redirectTarget, c.var.appConfig.sitePathPrefix),
      { headers },
    );
  } catch {
    return dsToast(
      i18n._(
        msg({
          message:
            "Wrong email or password. Check your credentials and try again.",
          comment: "@context: Error toast when sign-in credentials are wrong",
        }),
      ),
      "error",
    );
  }
});

signinRoutes.post("/signout", async (c) => {
  if (c.var.auth) {
    try {
      const res = await c.var.auth.api.signOut({
        headers: c.req.raw.headers,
        asResponse: true,
      });
      return dsRedirect(toPublicPath("/", c.var.appConfig.sitePathPrefix), {
        headers: res.headers,
      });
    } catch {
      // Ignore signout errors
    }
  }
  return dsRedirect(toPublicPath("/", c.var.appConfig.sitePathPrefix));
});
