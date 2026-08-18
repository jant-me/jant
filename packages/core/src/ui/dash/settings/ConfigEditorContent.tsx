/**
 * Config Editor — searchable runtime preferences with a server-rendered
 * fallback and a Light DOM Lit enhancement.
 */

import { msg } from "@lingui/core/macro";
import { useLingui } from "../../../i18n/context.js";
import { getOrBuildEntry } from "../../../i18n/supported-locales.js";
import { getTimeZoneOptions } from "../../../lib/timezones.js";
import { toPublicPath } from "../../../lib/url.js";
import type {
  ConfigEditorFieldState,
  ConfigEditorVisibleKey,
} from "../../../types.js";

interface FieldPresentation {
  description: string;
  optionLabels?: Record<string, string>;
}

export function ConfigEditorContent({
  fields,
  endpoint,
  sitePathPrefix,
}: {
  fields: ConfigEditorFieldState[];
  endpoint: string;
  sitePathPrefix: string;
}) {
  const { i18n } = useLingui();

  const presentations: Record<ConfigEditorVisibleKey, FieldPresentation> = {
    SITE_NAME: {
      description: i18n._(
        msg({
          message: "The title used across your site, browser tabs, and feeds.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    SITE_DESCRIPTION: {
      description: i18n._(
        msg({
          message:
            "Edit the multi-line introduction used on your home page and in metadata.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    SITE_LANGUAGE: {
      description: i18n._(
        msg({
          message:
            "Choose the content language announced to readers and search engines.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    DASHBOARD_LANGUAGE: {
      description: i18n._(
        msg({
          message: "The language used by the private Jant dashboard.",
          comment: "@context: Config Editor setting description",
        }),
      ),
      optionLabels: {
        "": i18n._(
          msg({
            message: "Follow content language",
            comment:
              "@context: Config Editor enum option for no explicit dashboard language",
          }),
        ),
        en: "English",
        "zh-Hans": "简体中文",
        "zh-Hant": "繁體中文",
      },
    },
    MULTILINGUAL_ENABLED: {
      description: i18n._(
        msg({
          message:
            "Whether each language gets its own home page, archive, and feed. Managed on the Language page.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    ADDITIONAL_LANGUAGES: {
      description: i18n._(
        msg({
          message:
            "The languages served under a URL prefix. Managed on the Language page.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    MAIN_RSS_FEED: {
      description: i18n._(
        msg({
          message: "Which post stream the canonical /feed URL returns.",
          comment: "@context: Config Editor setting description",
        }),
      ),
      optionLabels: {
        featured: i18n._(
          msg({
            message: "Featured posts",
            comment: "@context: Config Editor RSS feed enum option",
          }),
        ),
        latest: i18n._(
          msg({
            message: "Latest posts",
            comment: "@context: Config Editor RSS feed enum option",
          }),
        ),
      },
    },
    ARCHIVE_DEFAULT_LAYOUT: {
      description: i18n._(
        msg({
          message:
            "Which layout /archive opens with. Readers can switch layouts from the page.",
          comment: "@context: Config Editor setting description",
        }),
      ),
      optionLabels: {
        list: i18n._(
          msg({
            message: "Full posts",
            comment: "@context: Config Editor archive layout enum option",
          }),
        ),
        grid: i18n._(
          msg({
            message: "Tile grid",
            comment: "@context: Config Editor archive layout enum option",
          }),
        ),
      },
    },
    PAGE_SIZE: {
      description: i18n._(
        msg({
          message: "Set the default number of items shown per page.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    SEARCH_PAGE_SIZE: {
      description: i18n._(
        msg({
          message:
            "Set results per search page; reset to inherit the main page size.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    ARCHIVE_PAGE_SIZE: {
      description: i18n._(
        msg({
          message:
            "Set posts per archive page; reset to inherit the main page size.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    SUMMARY_MAX_PARAGRAPHS: {
      description: i18n._(
        msg({
          message:
            "Limit paragraphs used in automatically generated summaries.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    SUMMARY_MAX_CHARS: {
      description: i18n._(
        msg({
          message:
            "Limit characters used in automatically generated summaries.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    RSS_FEED_LIMIT: {
      description: i18n._(
        msg({
          message: "Limit posts included in each RSS feed.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    RSS_PUBLISH_DELAY_SECONDS: {
      description: i18n._(
        msg({
          message:
            "Delay new posts and replies before they appear in feeds. Use 0 to turn this off.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    THEME: {
      description: i18n._(
        msg({
          message: "Choose the color palette used across Jant.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    CUSTOM_CSS: {
      description: i18n._(
        msg({
          message: "Add site-wide CSS in the dedicated code editor.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    CUSTOM_HEAD_HTML: {
      description: i18n._(
        msg({
          message: "Add site-wide HTML before the closing head tag.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    CUSTOM_BODY_END_HTML: {
      description: i18n._(
        msg({
          message: "Add site-wide HTML before the closing body tag.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    SITE_AVATAR: {
      description: i18n._(
        msg({
          message: "Upload the profile image and generated site icons.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    SHOW_HEADER_AVATAR: {
      description: i18n._(
        msg({
          message: "Show the site avatar in the public header.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    FONT_THEME: {
      description: i18n._(
        msg({
          message: "Choose the typography used across Jant.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    THEME_MODE: {
      description: i18n._(
        msg({
          message:
            "Follow the device appearance or force a light or dark theme.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    TIME_ZONE: {
      description: i18n._(
        msg({
          message: "Choose the time zone used to display dates and times.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    SITE_FOOTER: {
      description: i18n._(
        msg({
          message:
            "Edit the multi-line footer rendered at the bottom of public pages.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    SHOW_JANT_BRANDING_ON_HOME: {
      description: i18n._(
        msg({
          message: "Show the Jant credit on the home page.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    NOINDEX: {
      description: i18n._(
        msg({
          message:
            "Ask search engines not to index public pages or include them in results.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    PUBLIC_API_ENABLED: {
      description: i18n._(
        msg({
          message: "Allow published content to be read without an API token.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    RSS_FEEDS_ENABLED: {
      description: i18n._(
        msg({
          message: "Publish Atom feeds for the site, archive, and collections.",
          comment: "@context: Config Editor setting description",
        }),
      ),
    },
    GITHUB_SYNC_ENABLED: {
      description: i18n._(
        msg({
          message: "Connect or manage automatic content backups to GitHub.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    GITHUB_SYNC_REPO: {
      description: i18n._(
        msg({
          message: "Choose the repository used for content backups.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
    TELEGRAM_BOT_USERNAME: {
      description: i18n._(
        msg({
          message: "Connect or manage the bot used to post from Telegram.",
          comment: "@context: Config Editor linked setting description",
        }),
      ),
    },
  };

  const localizedFields = fields.map((field) => {
    let optionLabels = presentations[field.key].optionLabels;
    if (field.key === "SITE_LANGUAGE") {
      optionLabels = Object.fromEntries(
        (field.options ?? []).map((option) => [
          option,
          `${getOrBuildEntry(option).native} — ${option}`,
        ]),
      );
    } else if (field.key === "TIME_ZONE") {
      const timeZoneLabels = new Map(
        getTimeZoneOptions(field.value).map((entry) => [
          entry.value,
          entry.label,
        ]),
      );
      optionLabels = Object.fromEntries(
        (field.options ?? []).map((option) => [
          option,
          `${timeZoneLabels.get(option) ?? option} — ${option}`,
        ]),
      );
    }

    return {
      ...field,
      ...presentations[field.key],
      ...(optionLabels && { optionLabels }),
      ...(field.settingsPath && {
        settingsPath: toPublicPath(field.settingsPath, sitePathPrefix),
      }),
    };
  });
  const initialData = JSON.stringify({ fields: localizedFields }).replace(
    /</g,
    "\\u003c",
  );
  const countTemplate = i18n._(
    msg({
      message: "{count} settings shown",
      comment: "@context: Config Editor live search result count",
    }),
    { count: "{count}" },
  );
  const modifiedLabel = i18n._(
    msg({
      message: "Modified",
      comment: "@context: Config Editor badge for a database override",
    }),
  );
  const labels = JSON.stringify({
    search: i18n._(
      msg({
        message: "Search settings",
        comment: "@context: Config Editor search input placeholder",
      }),
    ),
    modifiedOnly: i18n._(
      msg({
        message: "Show only modified",
        comment: "@context: Config Editor filter checkbox",
      }),
    ),
    modified: modifiedLabel,
    locked: i18n._(
      msg({
        message: "Locked",
        comment:
          "@context: Config Editor badge for a setting locked by the runtime",
      }),
    ),
    reset: i18n._(
      msg({
        message: "Reset to default",
        comment: "@context: Config Editor row action",
      }),
    ),
    saving: i18n._(
      msg({
        message: "Saving…",
        comment: "@context: Config Editor row save status",
      }),
    ),
    saved: i18n._(
      msg({
        message: "Saved",
        comment: "@context: Config Editor row save status",
      }),
    ),
    saveError: i18n._(
      msg({
        message: "This setting wasn't saved. Check the value and try again.",
        comment: "@context: Config Editor fallback error message",
      }),
    ),
    noMatches: i18n._(
      msg({
        message:
          "Nothing matches this search. Try a different name or description.",
        comment: "@context: Config Editor empty search state",
      }),
    ),
    countTemplate,
    openSetting: i18n._(
      msg({
        message: "Open setting",
        comment: "@context: Config Editor link to a dedicated settings page",
      }),
    ),
    configured: i18n._(
      msg({
        message: "Configured",
        comment: "@context: Config Editor linked setting status",
      }),
    ),
    notConfigured: i18n._(
      msg({
        message: "Not configured",
        comment: "@context: Config Editor linked setting status",
      }),
    ),
  }).replace(/</g, "\\u003c");

  return (
    <div class="config-editor-page">
      <header class="page-intro">
        <h1 class="page-intro-title">
          {i18n._(
            msg({
              message: "Config Editor",
              comment: "@context: Config Editor page title",
            }),
          )}
        </h1>
        <p class="page-intro-description">
          {i18n._(
            msg({
              message:
                "Search and edit runtime settings. Changes apply immediately; reset restores the environment or built-in default.",
              comment: "@context: Config Editor page description",
            }),
          )}
        </p>
      </header>

      <jant-config-editor
        endpoint={endpoint}
        initial-data={initialData}
        labels={labels}
      >
        <div class="config-editor-fallback">
          <div class="config-editor-toolbar">
            <input
              type="search"
              name="config-search"
              class="input config-editor-search-input"
              placeholder={i18n._(
                msg({
                  message: "Search settings",
                  comment: "@context: Config Editor search input placeholder",
                }),
              )}
              disabled
            />
          </div>
          <div class="config-editor-toolbar-meta">
            <p class="config-editor-count">
              {countTemplate.replace("{count}", String(localizedFields.length))}
            </p>
          </div>
          <ul class="config-editor-list">
            {localizedFields.map((field) => (
              <li class="config-editor-row" key={field.key}>
                <div class="config-editor-copy">
                  <div class="config-editor-heading">
                    <code class="config-editor-key" translate="no">
                      {field.key}
                    </code>
                    {field.modified ? (
                      <span class="config-editor-state config-editor-modified">
                        {modifiedLabel}
                      </span>
                    ) : null}
                  </div>
                  <p class="config-editor-description">{field.description}</p>
                </div>
                <div class="config-editor-value-column">
                  <div class="config-editor-control-row">
                    {field.mode === "link" ? (
                      <a
                        class="config-editor-open-control"
                        href={field.settingsPath}
                      >
                        <span class="config-editor-linked-value" translate="no">
                          {field.display === "configured"
                            ? field.value === "true"
                              ? i18n._(
                                  msg({
                                    message: "Configured",
                                    comment:
                                      "@context: Config Editor linked setting status",
                                  }),
                                )
                              : i18n._(
                                  msg({
                                    message: "Not configured",
                                    comment:
                                      "@context: Config Editor linked setting status",
                                  }),
                                )
                            : field.value}
                        </span>
                        <span class="config-editor-open-action">
                          {i18n._(
                            msg({
                              message: "Open setting",
                              comment:
                                "@context: Config Editor link to a dedicated settings page",
                            }),
                          )}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M5 12h14" />
                            <path d="m13 6 6 6-6 6" />
                          </svg>
                        </span>
                      </a>
                    ) : (
                      <output class="config-editor-fallback-value">
                        {field.type === "enum"
                          ? (field.optionLabels?.[field.value] ?? field.value)
                          : field.value}
                      </output>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </jant-config-editor>
    </div>
  );
}
