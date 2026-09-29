import {
  CONFIG_FIELDS,
  type Bindings,
  type ConfigEditorDefinition,
  type ConfigEditorFieldState,
  type ConfigEditorKey,
  type ConfigEditorResettableKey,
  type ConfigEditorVisibleKey,
  type ConfigKey,
} from "../types.js";
import { getSupportedLocaleEntries } from "../i18n/supported-locales.js";
import { SETTINGS_KEYS } from "./constants.js";
import { getEnvString } from "./env.js";
import { readConfigEnvValue } from "./env-values.js";
import { normalizeEditableSettingValue } from "./schemas.js";
import { getTimeZoneOptions } from "./timezones.js";
import { getAvailableThemes } from "./theme.js";
import { BUILTIN_FONT_THEMES } from "../ui/font-themes.js";
import { THEME_MODES } from "../types/config.js";
import { ValidationError } from "./errors.js";

/**
 * Settings a demo site's shared visitors can't change: indexing stays off, and
 * custom CSS would restyle the site for everyone until the nightly reset.
 */
export const demoLockedSettingKeys = new Set<ConfigKey>([
  "NOINDEX",
  "CUSTOM_CSS",
]);

/** Config keys explicitly approved for runtime editing. */
export const editableSettingKeys = Object.entries(CONFIG_FIELDS)
  .filter(([, field]) => "editor" in field)
  .map(([key]) => key as ConfigEditorKey);

/** Safe settings shown in Config Editor, including dedicated-page links. */
export const configEditorVisibleKeys = Object.entries(CONFIG_FIELDS)
  .filter(([, field]) => "editor" in field || "configEditorLink" in field)
  .map(([key]) => key as ConfigEditorVisibleKey);

/** Config Editor keys whose DB override can be safely removed directly. */
export const resettableConfigEditorKeys = Object.entries(CONFIG_FIELDS)
  .filter(
    ([, field]) =>
      "editor" in field ||
      ("configEditorLink" in field &&
        "resettable" in field.configEditorLink &&
        field.configEditorLink.resettable === true),
  )
  .map(([key]) => key as ConfigEditorResettableKey);

export function isEditableSettingKey(key: string): key is ConfigEditorKey {
  return editableSettingKeys.includes(key as ConfigEditorKey);
}

export function isResettableConfigEditorKey(
  key: string,
): key is ConfigEditorResettableKey {
  return resettableConfigEditorKeys.includes(key as ConfigEditorResettableKey);
}

function tryNormalizeResolvedSettingValue(
  key: ConfigEditorKey,
  value: string,
): string | undefined {
  try {
    return normalizeEditableSettingValue(key, value);
  } catch {
    return undefined;
  }
}

export function getEditableSettingFallbackValue(
  key: ConfigEditorKey,
  env?: Bindings,
  allSettings: Record<string, string> = {},
): string {
  const field = CONFIG_FIELDS[key];
  const envValue = env ? readConfigEnvValue(env, key) : undefined;
  if (envValue) return envValue;

  const normalizedDefault = tryNormalizeResolvedSettingValue(
    key,
    field.defaultValue,
  );
  if (normalizedDefault !== undefined) return normalizedDefault;

  if ("fallbackKey" in field && field.fallbackKey) {
    return getEditableSettingValue(allSettings, field.fallbackKey, env);
  }

  throw new Error(`Missing valid Config Editor fallback for ${key}`);
}

export function getEditableSettingValue(
  allSettings: Record<string, string>,
  key: ConfigEditorKey,
  env?: Bindings,
): string {
  const fallbackValue = getEditableSettingFallbackValue(key, env, allSettings);
  const value = Object.hasOwn(allSettings, key)
    ? allSettings[key]
    : fallbackValue;
  return (
    tryNormalizeResolvedSettingValue(key, value ?? fallbackValue) ??
    fallbackValue
  );
}

function getEditorConstraints(
  key: ConfigEditorKey,
  definition: ConfigEditorDefinition,
  value: string,
  fallbackValue: string,
): Pick<
  ConfigEditorFieldState,
  "maxLength" | "min" | "max" | "step" | "options"
> {
  switch (definition.type) {
    case "boolean":
      return {};
    case "string":
      return { maxLength: definition.maxLength };
    case "number":
      return {
        min: definition.min,
        max: definition.max,
        step: definition.step,
      };
    case "enum":
      if (definition.options) return { options: definition.options };
      if (definition.optionsSource === "contentLanguage") {
        const options = getSupportedLocaleEntries().map((entry) => entry.tag);
        for (const candidate of [fallbackValue, value]) {
          if (candidate && !options.includes(candidate))
            options.push(candidate);
        }
        return { options };
      }
      if (definition.optionsSource === "timeZone") {
        const options = getTimeZoneOptions(value).map((entry) => entry.value);
        for (const candidate of [fallbackValue, value]) {
          if (candidate && !options.includes(candidate))
            options.push(candidate);
        }
        return { options };
      }
      return { options: [value] };
  }
}

function buildLinkedConfigEditorField(
  allSettings: Record<string, string>,
  env: Bindings,
  key: ConfigEditorVisibleKey,
): ConfigEditorFieldState {
  const field = CONFIG_FIELDS[key];
  if (!("configEditorLink" in field)) {
    throw new Error(`Missing Config Editor link metadata for ${key}`);
  }
  const definition = field.configEditorLink;
  const resettable =
    "resettable" in definition && definition.resettable === true;
  const modified = Object.hasOwn(allSettings, key);
  const storedValue = allSettings[key] ?? "";

  if (definition.display === "configured") {
    const envKeys = "envKeys" in field ? field.envKeys : [];
    const fallbackRawValue =
      getEnvString(env, ...envKeys) || field.defaultValue;
    const effectiveValue = modified ? storedValue : fallbackRawValue;
    return {
      key,
      mode: "link",
      type: definition.type,
      value: effectiveValue.trim() ? "true" : "false",
      fallbackValue: fallbackRawValue.trim() ? "true" : "false",
      modified,
      locked: false,
      settingsPath: definition.settingsPath,
      display: definition.display,
      ...(resettable && { resettable: true }),
    };
  }

  const fieldEnvKeys = "envKeys" in field ? field.envKeys : [];
  let fallbackValue: string =
    ("fallbackValue" in definition ? definition.fallbackValue : undefined) ??
    getEnvString(env, ...fieldEnvKeys) ??
    field.defaultValue;
  if ("fallbackKey" in definition && definition.fallbackKey) {
    const fallbackField = CONFIG_FIELDS[definition.fallbackKey];
    const envKeys = "envKeys" in fallbackField ? fallbackField.envKeys : [];
    fallbackValue = getEnvString(env, ...envKeys) || fallbackField.defaultValue;
  }
  const value = storedValue.trim() || fallbackValue;

  return {
    key,
    mode: "link",
    type: definition.type,
    value: definition.type === "boolean" ? String(value === "true") : value,
    fallbackValue,
    modified,
    locked: false,
    settingsPath: definition.settingsPath,
    display: definition.display,
    ...(resettable && { resettable: true }),
  };
}

export function buildConfigEditorFields(
  allSettings: Record<string, string>,
  env: Bindings,
  demoMode: boolean,
): ConfigEditorFieldState[] {
  return configEditorVisibleKeys.map((key) => {
    if ("configEditorLink" in CONFIG_FIELDS[key]) {
      return buildLinkedConfigEditorField(allSettings, env, key);
    }

    if (!isEditableSettingKey(key)) {
      throw new Error(`Missing Config Editor metadata for ${key}`);
    }

    const definition: ConfigEditorDefinition = CONFIG_FIELDS[key].editor;
    const fallbackValue = getEditableSettingFallbackValue(
      key,
      env,
      allSettings,
    );
    const value =
      demoMode && key === SETTINGS_KEYS.NOINDEX
        ? "true"
        : getEditableSettingValue(allSettings, key, env);
    const fallbackKey = (CONFIG_FIELDS[key] as { fallbackKey?: "PAGE_SIZE" })
      .fallbackKey;
    const base = {
      key,
      mode: "edit" as const,
      type: definition.type,
      value,
      fallbackValue,
      modified: Object.hasOwn(allSettings, key),
      locked: demoMode && demoLockedSettingKeys.has(key),
      ...(fallbackKey ? { fallbackKey } : {}),
    };

    return {
      ...base,
      ...getEditorConstraints(key, definition, value, fallbackValue),
    };
  });
}

/**
 * Appearance settings, each edited on its own settings screen rather than as
 * a Config Editor row. The API reads and writes them next to the editable
 * ones.
 */
export const appearanceSettingKeys = [
  "THEME",
  "FONT_THEME",
  "THEME_MODE",
  "CUSTOM_CSS",
  "SHOW_HEADER_AVATAR",
] as const satisfies readonly ConfigKey[];
type AppearanceSettingKey = (typeof appearanceSettingKeys)[number];

/**
 * The site's languages. `GET /api/settings` reports them; only the language
 * rules write them: Settings → Languages, or a site import restoring what an
 * export recorded (`PUT /api/settings/import`).
 */
export const languageSettingKeys = [
  "MULTILINGUAL_ENABLED",
  "ADDITIONAL_LANGUAGES",
] as const satisfies readonly ConfigKey[];

function isAppearanceSettingKey(key: string): key is AppearanceSettingKey {
  return (appearanceSettingKeys as readonly string[]).includes(key);
}

/** The value an appearance or language setting has in effect. */
function readScreenSetting(
  allSettings: Record<string, string>,
  key: AppearanceSettingKey | (typeof languageSettingKeys)[number],
  env?: Bindings,
): string {
  const stored = allSettings[key] ?? "";
  switch (key) {
    case "THEME":
      return (
        stored ||
        (env && getEnvString(env, "DEFAULT_THEME")) ||
        CONFIG_FIELDS.DEFAULT_THEME.defaultValue
      );
    case "FONT_THEME":
      return (
        stored ||
        (env && getEnvString(env, "DEFAULT_FONT_THEME")) ||
        CONFIG_FIELDS.DEFAULT_FONT_THEME.defaultValue
      );
    case "THEME_MODE":
      return (THEME_MODES as readonly string[]).includes(stored)
        ? stored
        : "auto";
    case "SHOW_HEADER_AVATAR":
    case "MULTILINGUAL_ENABLED":
      return String(stored === "true");
    case "CUSTOM_CSS":
    case "ADDITIONAL_LANGUAGES":
      return stored;
  }
}

/**
 * Check an appearance setting's value the way its settings screen would.
 *
 * @param key - The appearance setting
 * @param value - The value a client sent
 * @returns The value to store
 * @throws {ValidationError} When the screen would not offer that value
 * @example
 * normalizeAppearanceSettingValue("THEME_MODE", "dark"); // "dark"
 */
export function normalizeAppearanceSettingValue(
  key: AppearanceSettingKey,
  value: string,
): string {
  const trimmed = value.trim();
  switch (key) {
    case "THEME": {
      const ids = getAvailableThemes().map((theme) => theme.id);
      if (trimmed && !ids.includes(trimmed)) {
        throw new ValidationError(
          `THEME must be a theme ID: ${ids.join(", ")}.`,
        );
      }
      return trimmed;
    }
    case "FONT_THEME": {
      const ids = BUILTIN_FONT_THEMES.map((theme) => theme.id);
      if (trimmed && !ids.includes(trimmed)) {
        throw new ValidationError(
          `FONT_THEME must be a font theme ID: ${ids.join(", ")}.`,
        );
      }
      return trimmed;
    }
    case "THEME_MODE":
      if (!(THEME_MODES as readonly string[]).includes(trimmed)) {
        throw new ValidationError(
          `THEME_MODE must be one of: ${THEME_MODES.join(", ")}.`,
        );
      }
      return trimmed;
    case "SHOW_HEADER_AVATAR":
      if (trimmed !== "true" && trimmed !== "false") {
        throw new ValidationError(
          'SHOW_HEADER_AVATAR must be "true" or "false".',
        );
      }
      return trimmed;
    case "CUSTOM_CSS":
      return trimmed;
  }
}

/**
 * Every setting `GET /api/settings` reports, with the value in effect: the
 * Config Editor's editable settings, the appearance settings, and the
 * languages.
 */
export function buildApiSettingsResponse(
  allSettings: Record<string, string>,
  demoMode: boolean,
  env?: Bindings,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of editableSettingKeys) {
    result[key] = getEditableSettingValue(allSettings, key, env);
  }
  for (const key of [...appearanceSettingKeys, ...languageSettingKeys]) {
    result[key] = readScreenSetting(allSettings, key, env);
  }
  if (demoMode) {
    result.NOINDEX = "true";
  }

  return result;
}

/**
 * Split a `PUT /api/settings` body into what it may write and what it names
 * that it may not. Appearance values are checked here; editable ones when the
 * settings service stores them.
 *
 * @throws {ValidationError} When an appearance value isn't one its screen offers
 */
export function partitionApiSettingUpdates(
  updates: Record<string, string>,
  demoMode: boolean,
): {
  filteredUpdates: Partial<Record<ConfigKey, string>>;
  rejectedKeys: string[];
} {
  const filteredUpdates: Partial<Record<ConfigKey, string>> = {};
  const rejectedKeys: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (!isEditableSettingKey(key) && !isAppearanceSettingKey(key)) {
      rejectedKeys.push(key);
    } else if (demoMode && demoLockedSettingKeys.has(key)) {
      rejectedKeys.push(key);
    } else {
      filteredUpdates[key] = isAppearanceSettingKey(key)
        ? normalizeAppearanceSettingValue(key, value)
        : value;
    }
  }

  return {
    filteredUpdates,
    rejectedKeys,
  };
}

/**
 * Split a `PUT /api/settings/import` body into the language settings it
 * restores and the keys it names that it doesn't take.
 */
export function partitionLanguageSettingUpdates(
  updates: Record<string, string>,
): {
  filteredUpdates: Partial<Record<ConfigKey, string>>;
  rejectedKeys: string[];
} {
  const filteredUpdates: Partial<Record<ConfigKey, string>> = {};
  const rejectedKeys: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if ((languageSettingKeys as readonly string[]).includes(key)) {
      filteredUpdates[key as ConfigKey] = value;
    } else {
      rejectedKeys.push(key);
    }
  }

  return {
    filteredUpdates,
    rejectedKeys,
  };
}
