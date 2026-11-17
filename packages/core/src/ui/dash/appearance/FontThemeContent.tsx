/**
 * Font theme picker
 */

import { msg } from "@lingui/core/macro";
import { useLingui } from "../../../i18n/context.js";
import { getFontThemeCssVariables, type FontTheme } from "../../font-themes.js";
import { toPublicPath } from "../../../lib/url.js";

const FONT_THEME_PREVIEW = {
  title: "Field notes on quiet design",
  bodyLead: "A short note should feel steady. Even",
  bodyLink: "a saved reference",
  bodyTail: "should sit inside the paragraph without breaking its rhythm.",
  linkLabel: "Editorial interfaces worth borrowing from",
  linkMeta: "example.com",
  quote: "The right theme disappears into the writing until you need it.",
} as const;

function toInlineStyle(variables: Record<string, string>): string {
  return Object.entries(variables)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

export function FontThemeContent({
  fontThemes,
  currentFontThemeId,
  sitePathPrefix = "",
}: {
  fontThemes: FontTheme[];
  currentFontThemeId: string;
  sitePathPrefix?: string;
}) {
  const { i18n } = useLingui();

  return (
    <div
      data-signals={JSON.stringify({ fontTheme: currentFontThemeId }).replace(
        /</g,
        "\\u003c",
      )}
      data-on:change={`@post('${toPublicPath("/settings/font-theme", sitePathPrefix)}')`}
      class="max-w-form"
    >
      <fieldset>
        <legend class="text-lg font-semibold">
          {i18n._(
            msg({
              message: "Font theme",
              comment: "@context: Appearance settings heading for font theme",
            }),
          )}
        </legend>
        <p class="text-sm text-muted-foreground mb-4">
          {i18n._(
            msg({
              message:
                "Choose a typographic direction for your site. Each theme changes both the font pairing and the reading rhythm.",
              comment: "@context: Font theme settings description",
            }),
          )}
        </p>
        <div class="flex flex-col gap-4">
          {fontThemes.map((ft) => (
            <label
              key={ft.id}
              class={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${ft.id === currentFontThemeId ? "border-primary" : "border-border"}`}
              data-class:border-primary={`$fontTheme === '${ft.id}'`}
              data-class:border-border={`$fontTheme !== '${ft.id}'`}
            >
              <input
                type="radio"
                name="fontTheme"
                value={ft.id}
                data-bind="fontTheme"
                checked={ft.id === currentFontThemeId || undefined}
                class="mt-1"
              />
              <div>
                <div class="font-medium">{i18n._(ft.name)}</div>
                <div class="text-sm text-muted-foreground">
                  {i18n._(ft.description)}
                </div>
                <div
                  class="mt-3 rounded-xl border border-border/70 bg-muted/30 p-4"
                  style={toInlineStyle(getFontThemeCssVariables(ft))}
                  lang="en"
                >
                  <div
                    class="text-[1.35rem] text-foreground"
                    style="font-family:var(--font-heading);font-weight:var(--type-display-weight);letter-spacing:var(--type-display-tracking);line-height:var(--type-display-leading)"
                  >
                    {FONT_THEME_PREVIEW.title}
                  </div>
                  <div
                    class="prose max-w-none mt-2 text-muted-foreground"
                    style="font-family:var(--font-body);font-size:var(--type-body-size);line-height:var(--type-body-leading);letter-spacing:var(--type-body-tracking)"
                  >
                    <p>
                      {FONT_THEME_PREVIEW.bodyLead}{" "}
                      <a
                        href={toPublicPath("/_/theme-sample", sitePathPrefix)}
                        class="pointer-events-none"
                        tabIndex={-1}
                        aria-hidden="true"
                      >
                        {FONT_THEME_PREVIEW.bodyLink}
                      </a>{" "}
                      {FONT_THEME_PREVIEW.bodyTail}
                    </p>
                  </div>
                  <div
                    class="mt-3"
                    style="font-family:var(--font-body);font-size:var(--type-body-size);line-height:var(--type-body-leading);letter-spacing:var(--type-body-tracking)"
                  >
                    <div class="feed-link-domain">
                      <span>{FONT_THEME_PREVIEW.linkMeta}</span>
                      <svg
                        class="feed-link-domain-icon"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke-width="2"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </div>
                    <div class="feed-link-title mt-1">
                      <span class="feed-link-title-link">
                        {FONT_THEME_PREVIEW.linkLabel}
                      </span>
                    </div>
                  </div>
                  <blockquote class="feed-quote feed-quote-card mt-4">
                    <div class="feed-quote-content">
                      {FONT_THEME_PREVIEW.quote}
                    </div>
                  </blockquote>
                </div>
              </div>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
