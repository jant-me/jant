/**
 * General settings form
 */

import { useLingui } from "@lingui/react/macro";
import type { TimezoneEntry } from "../../../lib/timezones.js";
import { SettingsNav } from "./SettingsNav.js";

/**
 * Build data-signals JSON with `_orig_<key>` duplicates for cancel/reset.
 * Private `_orig_*` signals store original values so Cancel can revert.
 * The `dirty` signal tracks whether the user has made any changes.
 */
function buildSignals(fields: Record<string, string>, dirty: string): string {
  const signals: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    signals[key] = value;
    signals[`_orig_${key}`] = value;
  }
  signals[dirty] = false;
  return JSON.stringify(signals).replace(/</g, "\\u003c");
}

/** Spinner SVG shown inside buttons during loading */
function Spinner({ show }: { show: string }) {
  return (
    <svg
      data-show={show}
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
  );
}

/**
 * Save + Cancel button pair.
 * Both are disabled when no changes (`!dirty`) or during loading.
 * Cancel resets all signals to originals and clears dirty.
 */
function FormActions({
  indicator,
  dirty,
  fields,
}: {
  indicator: string;
  dirty: string;
  fields: string[];
}) {
  const { t } = useLingui();
  const resetExpr = [
    ...fields.map((f) => `$${f} = $_orig_${f}`),
    `$${dirty} = false`,
  ].join("; ");

  return (
    <div class="flex gap-2 mt-4">
      <button
        type="submit"
        class="btn"
        disabled
        data-attr:disabled={`$${indicator} || !$${dirty}`}
      >
        <Spinner show={`$${indicator}`} />
        {t({
          message: "Save",
          comment: "@context: Button to save settings",
        })}
      </button>
      <button
        type="button"
        class="btn-outline"
        disabled
        data-attr:disabled={`$${indicator} || !$${dirty}`}
        data-on:click={resetExpr}
      >
        {t({
          message: "Cancel",
          comment:
            "@context: Button to cancel unsaved changes and revert to original values",
        })}
      </button>
    </div>
  );
}

export function GeneralContent({
  siteName,
  siteDescription,
  siteLanguage,
  homeDefaultView,
  siteNameFallback,
  siteDescriptionFallback,
  siteAvatarUrl,
  showHeaderAvatar,
  timeZone,
  siteFooter,
  noindex,
  timezones,
}: {
  siteName: string;
  siteDescription: string;
  siteLanguage: string;
  homeDefaultView: string;
  siteNameFallback: string;
  siteDescriptionFallback: string;
  siteAvatarUrl: string;
  showHeaderAvatar: boolean;
  timeZone: string;
  siteFooter: string;
  noindex: boolean;
  timezones: TimezoneEntry[];
}) {
  const { t } = useLingui();

  const generalSignals = buildSignals(
    {
      siteName,
      siteDescription,
      siteLanguage,
      homeDefaultView,
      timeZone,
    },
    "_generalDirty",
  );

  const footerSignals = buildSignals({ siteFooter }, "_footerDirty");

  const seoSignals = buildSignals(
    { noindex: noindex ? "" : "true" },
    "_seoDirty",
  );

  const avatarSignals = buildSignals(
    { showHeaderAvatar: showHeaderAvatar ? "true" : "" },
    "_avatarDisplayDirty",
  );

  return (
    <>
      <h1 class="text-2xl font-semibold mb-2">
        {t({ message: "Settings", comment: "@context: Dashboard heading" })}
      </h1>
      <SettingsNav currentTab="general" />

      <div class="flex flex-col gap-6 max-w-lg">
        {/* Blog Avatar */}
        <div class="card">
          <header>
            <h2>
              {t({
                message: "Blog Avatar",
                comment: "@context: Settings section heading for avatar",
              })}
            </h2>
          </header>
          <section class="flex flex-col gap-4">
            <div class="flex items-center gap-4">
              {siteAvatarUrl ? (
                <img
                  src={siteAvatarUrl}
                  alt=""
                  class="rounded-full object-cover"
                  style="width:64px;height:64px"
                />
              ) : (
                <div
                  class="rounded-full bg-muted flex items-center justify-center text-muted-foreground"
                  style="width:64px;height:64px"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                </div>
              )}
              <div class="flex flex-col gap-2">
                <form
                  action="/dash/settings/avatar"
                  method="post"
                  enctype="multipart/form-data"
                  class="inline"
                >
                  <label class="btn text-sm cursor-pointer">
                    {t({
                      message: "Upload Avatar",
                      comment: "@context: Button to upload avatar image",
                    })}
                    <input
                      type="file"
                      name="file"
                      accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                      class="hidden"
                      data-avatar-upload
                      data-text-processing={t({
                        message: "Processing...",
                        comment:
                          "@context: Avatar upload button text while generating favicon variants",
                      })}
                      data-text-uploading={t({
                        message: "Uploading...",
                        comment:
                          "@context: Avatar upload button text while uploading",
                      })}
                      data-text-error={t({
                        message: "Upload failed. Please try again.",
                        comment:
                          "@context: Error message when avatar upload fails",
                      })}
                    />
                  </label>
                </form>
                {siteAvatarUrl && (
                  <form
                    data-on:submit__prevent="@post('/dash/settings/avatar/remove')"
                    data-indicator="_removeAvatarLoading"
                  >
                    <button
                      type="submit"
                      class="btn-outline text-sm"
                      data-attr:disabled="$_removeAvatarLoading"
                    >
                      {t({
                        message: "Remove",
                        comment: "@context: Button to remove the blog avatar",
                      })}
                    </button>
                  </form>
                )}
              </div>
            </div>
            <p class="text-sm text-muted-foreground">
              {t({
                message:
                  "This is used for your favicon and apple-touch-icon. For best results, upload a square image at least 180x180 pixels.",
                comment: "@context: Help text for avatar upload",
              })}
            </p>
            <form
              data-signals={avatarSignals}
              data-on:submit__prevent="@post('/dash/settings/avatar/display')"
              data-indicator="_avatarDisplayLoading"
            >
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  class="checkbox"
                  data-bind="showHeaderAvatar"
                  data-on:change="$_avatarDisplayDirty = true"
                  checked={showHeaderAvatar || undefined}
                  value="true"
                />
                <span>
                  {t({
                    message: "Display avatar in my site header",
                    comment:
                      "@context: Checkbox to show avatar in the site header",
                  })}
                </span>
              </label>
              <FormActions
                indicator="_avatarDisplayLoading"
                dirty="_avatarDisplayDirty"
                fields={["showHeaderAvatar"]}
              />
            </form>
          </section>
        </div>

        {/* General settings */}
        <form
          data-signals={generalSignals}
          data-on:submit__prevent="@post('/dash/settings')"
          data-indicator="_generalLoading"
        >
          <div class="card">
            <header>
              <h2>
                {t({
                  message: "General",
                  comment: "@context: Settings section heading",
                })}
              </h2>
            </header>
            <section class="flex flex-col gap-4">
              <div class="field">
                <label class="label">
                  {t({
                    message: "Site Name",
                    comment: "@context: Settings form field",
                  })}
                </label>
                <input
                  type="text"
                  data-bind="siteName"
                  data-on:input="$_generalDirty = true"
                  class="input"
                  placeholder={siteNameFallback}
                />
              </div>

              <div class="field">
                <label class="label">
                  {t({
                    message: "About this blog",
                    comment:
                      "@context: Settings form field for site description",
                  })}
                </label>
                <textarea
                  data-bind="siteDescription"
                  data-on:input="$_generalDirty = true"
                  class="textarea"
                  rows={3}
                  placeholder={siteDescriptionFallback}
                >
                  {siteDescription}
                </textarea>
                <p class="text-sm text-muted-foreground mt-1">
                  {t({
                    message:
                      "This is displayed above your blog posts on your default home page. This is also used for the meta description on your home page.",
                    comment: "@context: Help text for site description field",
                  })}
                </p>
              </div>

              <div class="field">
                <label class="label">
                  {t({
                    message: "Language",
                    comment: "@context: Settings form field",
                  })}
                </label>
                <select
                  data-bind="siteLanguage"
                  data-on:change="$_generalDirty = true"
                  class="select"
                >
                  <option value="en" selected={siteLanguage === "en"}>
                    English
                  </option>
                  <option value="zh-Hans" selected={siteLanguage === "zh-Hans"}>
                    简体中文
                  </option>
                  <option value="zh-Hant" selected={siteLanguage === "zh-Hant"}>
                    繁體中文
                  </option>
                </select>
              </div>

              <div class="field">
                <label class="label">
                  {t({
                    message: "Default Homepage View",
                    comment: "@context: Settings form field",
                  })}
                </label>
                <select
                  data-bind="homeDefaultView"
                  data-on:change="$_generalDirty = true"
                  class="select"
                >
                  <option
                    value="latest"
                    selected={homeDefaultView === "latest"}
                  >
                    {t({
                      message: "Latest",
                      comment:
                        "@context: Homepage view option - show latest posts",
                    })}
                  </option>
                  <option
                    value="featured"
                    selected={homeDefaultView === "featured"}
                  >
                    {t({
                      message: "Featured",
                      comment:
                        "@context: Homepage view option - show featured posts",
                    })}
                  </option>
                </select>
              </div>

              <div class="field">
                <label class="label">
                  {t({
                    message: "Time Zone",
                    comment: "@context: Settings form field",
                  })}
                </label>
                <select
                  data-bind="timeZone"
                  data-on:change="$_generalDirty = true"
                  class="select"
                >
                  {timezones.map((tz) => (
                    <option
                      key={tz.value}
                      value={tz.value}
                      selected={timeZone === tz.value}
                    >
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
              <FormActions
                indicator="_generalLoading"
                dirty="_generalDirty"
                fields={[
                  "siteName",
                  "siteDescription",
                  "siteLanguage",
                  "homeDefaultView",
                  "timeZone",
                ]}
              />
            </section>
          </div>
        </form>

        {/* Site Footer */}
        <form
          data-signals={footerSignals}
          data-on:submit__prevent="@post('/dash/settings/footer')"
          data-indicator="_footerLoading"
        >
          <div class="card">
            <header>
              <h2>
                {t({
                  message: "Site Footer",
                  comment: "@context: Settings section heading for site footer",
                })}
              </h2>
            </header>
            <section class="flex flex-col gap-4">
              <textarea
                data-bind="siteFooter"
                data-on:input="$_footerDirty = true"
                class="textarea font-mono text-sm"
                rows={4}
                placeholder={t({
                  message: "Markdown supported",
                  comment: "@context: Placeholder for footer textarea",
                })}
              >
                {siteFooter}
              </textarea>
              <p class="text-sm text-muted-foreground">
                {t({
                  message:
                    "This is displayed at the bottom of all of your posts and pages. Markdown is supported.",
                  comment: "@context: Help text for site footer field",
                })}
              </p>
              <FormActions
                indicator="_footerLoading"
                dirty="_footerDirty"
                fields={["siteFooter"]}
              />
            </section>
          </div>
        </form>

        {/* SEO */}
        <form
          data-signals={seoSignals}
          data-on:submit__prevent="@post('/dash/settings/seo')"
          data-indicator="_seoLoading"
        >
          <div class="card">
            <header>
              <h2>
                {t({
                  message: "SEO",
                  comment: "@context: Settings section heading for SEO",
                })}
              </h2>
            </header>
            <section>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  class="checkbox"
                  data-bind="noindex"
                  data-on:change="$_seoDirty = true"
                  checked={!noindex || undefined}
                  value="true"
                />
                <span>
                  {t({
                    message: "It's OK for search engines to index my site",
                    comment:
                      "@context: Checkbox for allowing search engine indexing",
                  })}
                </span>
              </label>
              <FormActions
                indicator="_seoLoading"
                dirty="_seoDirty"
                fields={["noindex"]}
              />
            </section>
          </div>
        </form>
      </div>
    </>
  );
}
