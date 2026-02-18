/**
 * Setup Routes
 *
 * Initial admin account creation during first-time setup.
 */

import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { useLingui } from "@lingui/react/macro";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { BaseLayout } from "../../ui/layouts/BaseLayout.js";
import { dsRedirect, dsToast } from "../../lib/sse.js";
import { SetupSchema } from "../../lib/schemas.js";
import { mapIanaToTimezone } from "../../lib/timezones.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const SetupContent: FC = () => {
  const { t } = useLingui();

  return (
    <div class="min-h-screen flex items-center justify-center">
      <div class="card max-w-md w-full">
        <header>
          <h2>
            {t({
              message: "Welcome to Jant",
              comment: "@context: Setup page welcome heading",
            })}
          </h2>
          <p>
            {t({
              message: "Create your admin account.",
              comment: "@context: Setup page description",
            })}
          </p>
        </header>
        <section>
          <form
            data-signals="{name: '', email: '', password: '', _timezone: ''}"
            data-init="$_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''"
            data-on:submit__prevent="@post('/setup')"
            data-indicator="_loading"
            class="flex flex-col gap-4"
          >
            <div class="field">
              <label class="label">
                {t({
                  message: "Your Name",
                  comment: "@context: Setup form field - user name",
                })}
              </label>
              <input
                type="text"
                data-bind="name"
                class="input"
                required
                placeholder="John Doe"
              />
            </div>
            <div class="field">
              <label class="label">
                {t({
                  message: "Email",
                  comment: "@context: Setup/signin form field - email",
                })}
              </label>
              <input
                type="email"
                data-bind="email"
                class="input"
                required
                placeholder="you@example.com"
              />
            </div>
            <div class="field">
              <label class="label">
                {t({
                  message: "Password",
                  comment: "@context: Setup/signin form field - password",
                })}
              </label>
              <input
                type="password"
                data-bind="password"
                class="input"
                required
                minLength={8}
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
              {t({
                message: "Complete Setup",
                comment: "@context: Setup form submit button",
              })}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};

export const setupRoutes = new Hono<Env>();

setupRoutes.get("/setup", async (c) => {
  const isComplete = await c.var.services.settings.isOnboardingComplete();
  if (isComplete) return c.redirect("/");

  return c.html(
    <BaseLayout title="Setup - Jant" c={c}>
      <SetupContent />
    </BaseLayout>,
  );
});

setupRoutes.post("/setup", async (c) => {
  const isComplete = await c.var.services.settings.isOnboardingComplete();
  if (isComplete) return c.redirect("/");

  const body = await c.req.json<Record<string, string>>();
  const parsed = SetupSchema.safeParse(body);
  const browserTimezone = body._timezone;

  if (!parsed.success) {
    const msg = parsed.error.errors[0]?.message ?? "Invalid input";
    return dsToast(msg, "error");
  }

  const { name, email, password } = parsed.data;

  if (!c.var.auth) {
    return dsToast("AUTH_SECRET not configured", "error");
  }

  try {
    const signUpResponse = await c.var.auth.api.signUpEmail({
      body: { name, email, password },
    });

    if (!signUpResponse || "error" in signUpResponse) {
      return dsToast("Failed to create account", "error");
    }

    await c.var.services.settings.completeOnboarding();

    // Save auto-detected timezone
    if (browserTimezone) {
      const tz = mapIanaToTimezone(browserTimezone);
      if (tz !== "UTC") {
        await c.var.services.settings.set("TIME_ZONE", tz);
      }
    }

    await c.var.services.navItems.create({
      type: "link",
      label: "Collections",
      url: "/collections",
    });
    // Seed default navigation items
    await c.var.services.navItems.create({
      type: "link",
      label: "Archive",
      url: "/archive",
    });

    // Seed default About page
    const aboutPage = await c.var.services.pages.create({
      slug: "about",
      title: "About",
      body: [
        "Welcome to my corner of the internet.",
        "",
        "This is a place where I share my thoughts, ideas, and things I find interesting. Feel free to look around and get to know what this site is all about.",
        "",
        "If you'd like to get in touch, don't hesitate to reach out.",
      ].join("\n"),
      status: "published",
    });

    await c.var.services.navItems.create({
      type: "page",
      label: "About",
      url: "/about",
      pageId: aboutPage.id,
    });

    return dsRedirect("/signin?setup");
  } catch (err) {
    // eslint-disable-next-line no-console -- Error logging is intentional
    console.error("Setup error:", err);
    return dsToast("Failed to create account", "error");
  }
});
