import { describe, expect, it } from "vitest";
import {
  buildConfigEditorFields,
  buildEditableSettingsResponse,
  configEditorVisibleKeys,
  editableSettingKeys,
  isResettableConfigEditorKey,
  resettableConfigEditorKeys,
} from "../api-settings.js";
import { normalizeConfigEditorDefinitionValue } from "../schemas.js";
import type { Bindings } from "../../types.js";

describe("editable settings registry", () => {
  it("exposes only explicitly approved runtime settings", () => {
    expect(editableSettingKeys).toEqual([
      "SITE_NAME",
      "SITE_DESCRIPTION",
      "SITE_LANGUAGE",
      "DASHBOARD_LANGUAGE",
      "MAIN_RSS_FEED",
      "PAGE_SIZE",
      "SEARCH_PAGE_SIZE",
      "ARCHIVE_PAGE_SIZE",
      "SUMMARY_MAX_PARAGRAPHS",
      "SUMMARY_MAX_CHARS",
      "RSS_FEED_LIMIT",
      "RSS_PUBLISH_DELAY_SECONDS",
      "TIME_ZONE",
      "SITE_FOOTER",
      "SHOW_JANT_BRANDING_ON_HOME",
      "NOINDEX",
      "PUBLIC_API_ENABLED",
      "RSS_FEEDS_ENABLED",
    ]);
    expect(editableSettingKeys).not.toContain("AUTH_SECRET");
    // The multilingual keys are deliberately DB-only. Making them editable
    // here would let `PUT /api/settings` turn multilingual on without the
    // confirmation that stamps existing posts — every unstamped post would
    // then vanish from the root view — and add a language without the
    // URL-prefix conflict check.
    expect(editableSettingKeys).not.toContain("MULTILINGUAL_ENABLED");
    expect(editableSettingKeys).not.toContain("ADDITIONAL_LANGUAGES");
    expect(resettableConfigEditorKeys).not.toContain("MULTILINGUAL_ENABLED");
    expect(resettableConfigEditorKeys).not.toContain("ADDITIONAL_LANGUAGES");
    expect(editableSettingKeys).not.toContain("GITHUB_SYNC_TOKEN");
    expect(editableSettingKeys).not.toContain("SITE_AVATAR");
    expect(configEditorVisibleKeys).toEqual(
      expect.arrayContaining([
        "THEME",
        "FONT_THEME",
        "THEME_MODE",
        "CUSTOM_CSS",
        "CUSTOM_HEAD_HTML",
        "CUSTOM_BODY_END_HTML",
        "SITE_AVATAR",
        "SHOW_HEADER_AVATAR",
        "GITHUB_SYNC_ENABLED",
        "GITHUB_SYNC_REPO",
        "TELEGRAM_BOT_USERNAME",
      ]),
    );
    expect(configEditorVisibleKeys).not.toContain("GITHUB_SYNC_TOKEN");
    expect(configEditorVisibleKeys).not.toContain(
      "TELEGRAM_BOT_WEBHOOK_SECRET",
    );
    expect(configEditorVisibleKeys).not.toContain("SITE_FAVICON_VERSION");
    expect(resettableConfigEditorKeys).toEqual(
      expect.arrayContaining([
        ...editableSettingKeys,
        "THEME",
        "FONT_THEME",
        "THEME_MODE",
        "SHOW_HEADER_AVATAR",
      ]),
    );
    expect(isResettableConfigEditorKey("THEME")).toBe(true);
    expect(isResettableConfigEditorKey("CUSTOM_CSS")).toBe(false);
    expect(isResettableConfigEditorKey("SITE_AVATAR")).toBe(false);
  });

  it("builds typed editor state with environment fallbacks and overrides", () => {
    const fields = buildConfigEditorFields(
      {
        SITE_NAME: "Database name",
        SITE_LANGUAGE: "cy",
        PAGE_SIZE: "80",
        RSS_PUBLISH_DELAY_SECONDS: "0",
        TIME_ZONE: "Pacific/Chatham",
        CUSTOM_CSS: "body { color: red; }",
        GITHUB_SYNC_ENABLED: "true",
        GITHUB_SYNC_REPO: "jant/example",
        TELEGRAM_BOT_USERNAME: "jant_example_bot",
        SHOW_JANT_BRANDING_ON_HOME: "false",
      },
      {
        SITE_NAME: "Environment name",
        SITE_DESCRIPTION: "Environment description",
        NOINDEX: "true",
        RSS_PUBLISH_DELAY_SECONDS: "600",
      } as Bindings,
      false,
    );

    expect(fields.find((field) => field.key === "SITE_NAME")).toMatchObject({
      type: "string",
      mode: "link",
      value: "Database name",
      fallbackValue: "Environment name",
      modified: true,
      locked: false,
      resettable: true,
      settingsPath: "/settings/general",
    });
    expect(fields.find((field) => field.key === "NOINDEX")).toMatchObject({
      type: "boolean",
      value: "true",
      fallbackValue: "true",
      modified: false,
    });
    expect(
      fields.find((field) => field.key === "SITE_DESCRIPTION"),
    ).toMatchObject({
      mode: "link",
      value: "true",
      fallbackValue: "true",
      modified: false,
      resettable: true,
      settingsPath: "/settings/general",
    });
    expect(fields.find((field) => field.key === "SITE_LANGUAGE")).toMatchObject(
      {
        type: "enum",
        options: expect.arrayContaining(["en", "zh-Hans", "cy"]),
      },
    );
    expect(fields.find((field) => field.key === "TIME_ZONE")).toMatchObject({
      type: "enum",
      options: expect.arrayContaining(["UTC", "Pacific/Chatham"]),
    });
    expect(fields.find((field) => field.key === "MAIN_RSS_FEED")).toMatchObject(
      {
        type: "enum",
        options: ["featured", "latest"],
      },
    );
    expect(fields.find((field) => field.key === "PAGE_SIZE")).toMatchObject({
      mode: "edit",
      type: "number",
      value: "80",
      fallbackValue: "50",
      modified: true,
      min: 1,
      max: 100,
      step: 1,
    });
    expect(
      fields.find((field) => field.key === "RSS_PUBLISH_DELAY_SECONDS"),
    ).toMatchObject({
      mode: "edit",
      type: "number",
      value: "0",
      fallbackValue: "600",
      modified: true,
      min: 0,
      max: 7200,
      step: 1,
    });
    expect(
      fields.find((field) => field.key === "SEARCH_PAGE_SIZE"),
    ).toMatchObject({
      mode: "edit",
      type: "number",
      value: "80",
      fallbackValue: "80",
      modified: false,
      min: 1,
      max: 100,
      step: 1,
    });
    expect(fields.find((field) => field.key === "CUSTOM_CSS")).toMatchObject({
      mode: "link",
      value: "true",
      display: "configured",
      settingsPath: "/settings/custom-css",
    });
    expect(
      JSON.stringify(fields.find((field) => field.key === "CUSTOM_CSS")),
    ).not.toContain("color: red");
    expect(fields.find((field) => field.key === "THEME")).toMatchObject({
      mode: "link",
      resettable: true,
    });
    expect(
      fields.find((field) => field.key === "GITHUB_SYNC_ENABLED"),
    ).toMatchObject({
      mode: "link",
      value: "true",
      settingsPath: "/settings/github-sync",
    });
    expect(
      fields.find((field) => field.key === "GITHUB_SYNC_REPO"),
    ).toMatchObject({
      mode: "link",
      value: "true",
      display: "configured",
      settingsPath: "/settings/github-sync",
    });
    expect(
      JSON.stringify(fields.find((field) => field.key === "GITHUB_SYNC_REPO")),
    ).not.toContain("jant/example");
    expect(
      fields.find((field) => field.key === "TELEGRAM_BOT_USERNAME"),
    ).toMatchObject({
      mode: "link",
      value: "true",
      display: "configured",
      settingsPath: "/settings/telegram",
    });
    expect(
      fields.find((field) => field.key === "CUSTOM_CSS"),
    ).not.toHaveProperty("resettable");
  });

  it("locks noindex on in demo mode without exposing demo config", () => {
    const fields = buildConfigEditorFields({}, {} as Bindings, true);
    expect(fields.find((field) => field.key === "NOINDEX")).toMatchObject({
      value: "true",
      locked: true,
    });
    expect(editableSettingKeys as readonly string[]).not.toContain("DEMO_MODE");
  });

  it("returns canonical boolean defaults and environment fallbacks", () => {
    const settings = buildEditableSettingsResponse({}, false, {
      SITE_NAME: "From environment",
    } as Bindings);

    expect(settings.SITE_NAME).toBe("From environment");
    expect(settings.SHOW_JANT_BRANDING_ON_HOME).toBe("false");
    expect(settings.NOINDEX).toBe("false");
    expect(settings.RSS_PUBLISH_DELAY_SECONDS).toBe("300");
  });

  it("uses valid numeric environment values and inherited page-size fallbacks", () => {
    const settings = buildEditableSettingsResponse({ PAGE_SIZE: "75" }, false, {
      SEARCH_PAGE_SIZE: "invalid",
      ARCHIVE_PAGE_SIZE: "30",
    } as Bindings);

    expect(settings.PAGE_SIZE).toBe("75");
    expect(settings.SEARCH_PAGE_SIZE).toBe("75");
    expect(settings.ARCHIVE_PAGE_SIZE).toBe("30");
  });
});

describe("Config Editor value types", () => {
  it("normalizes boolean, text, number, and enum values", () => {
    expect(
      normalizeConfigEditorDefinitionValue({ type: "boolean" }, " TRUE "),
    ).toBe("true");
    expect(
      normalizeConfigEditorDefinitionValue(
        { type: "string", maxLength: 8 },
        "  text  ",
      ),
    ).toBe("text");
    expect(
      normalizeConfigEditorDefinitionValue(
        { type: "number", min: 1, max: 10, step: 0.5 },
        "2.5",
      ),
    ).toBe("2.5");
    expect(
      normalizeConfigEditorDefinitionValue(
        { type: "number", step: 0.1 },
        "0.3",
      ),
    ).toBe("0.3");
    expect(
      normalizeConfigEditorDefinitionValue(
        { type: "enum", options: ["one", "two"] },
        "two",
      ),
    ).toBe("two");
  });

  it("rejects invalid typed values", () => {
    expect(() =>
      normalizeConfigEditorDefinitionValue({ type: "boolean" }, "yes"),
    ).toThrow("Choose true or false");
    expect(() =>
      normalizeConfigEditorDefinitionValue({ type: "number", min: 1 }, "0"),
    ).toThrow("greater than or equal to 1");
    expect(() =>
      normalizeConfigEditorDefinitionValue(
        { type: "number", max: 100, step: 1 },
        "100.5",
      ),
    ).toThrow("less than or equal to 100");
    expect(() =>
      normalizeConfigEditorDefinitionValue(
        { type: "enum", options: ["one", "two"] },
        "three",
      ),
    ).toThrow("available options");
  });
});
