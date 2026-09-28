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
import { normalizeEditableSettingValue } from "./schemas.js";
import { getTimeZoneOptions } from "./timezones.js";

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
  const envKeys = "envKeys" in field ? field.envKeys : undefined;
  const envValue = env ? getEnvString(env, ...(envKeys ?? [])) : undefined;
  if (envValue) {
    const normalizedEnv = tryNormalizeResolvedSettingValue(key, envValue);
    if (normalizedEnv !== undefined) return normalizedEnv;
  }

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

export function buildEditableSettingsResponse(
  allSettings: Record<string, string>,
  demoMode: boolean,
  env?: Bindings,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of editableSettingKeys) {
    result[key] = getEditableSettingValue(allSettings, key, env);
  }
  if (demoMode) {
    result.NOINDEX = "true";
  }

  return result;
}

export function partitionEditableSettingUpdates(
  updates: Record<string, string>,
  demoMode: boolean,
): {
  filteredUpdates: Partial<Record<ConfigEditorKey, string>>;
  rejectedKeys: string[];
} {
  const filteredUpdates: Partial<Record<ConfigEditorKey, string>> = {};
  const rejectedKeys: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    const configKey = key as ConfigEditorKey;

    if (
      demoMode &&
      editableSettingKeys.includes(configKey) &&
      demoLockedSettingKeys.has(configKey)
    ) {
      rejectedKeys.push(key);
      continue;
    }

    if (editableSettingKeys.includes(configKey)) {
      filteredUpdates[configKey] = value;
    } else {
      rejectedKeys.push(key);
    }
  }

  return {
    filteredUpdates,
    rejectedKeys,
  };
}

/**
 * Internal config keys that the site importer is allowed to write. These are
 * keys that the UI manages through dedicated flows (theme picker, custom CSS
 * editor, header toggle) but that the site export emits as plain values and
 * the importer needs to restore verbatim. Bytes-and-storage-keyed internal
 * settings (favicon/avatar blobs, storage paths) are excluded — those round
 * trip through `/api/settings/avatar`, not this route.
 */
export const importableInternalSettingKeys = [
  "THEME",
  "FONT_THEME",
  "THEME_MODE",
  "CUSTOM_CSS",
  "SHOW_HEADER_AVATAR",
  // Restored through the language service, not written as they arrive.
  "MULTILINGUAL_ENABLED",
  "ADDITIONAL_LANGUAGES",
] as const satisfies readonly ConfigKey[];

export function partitionImportableSettingUpdates(
  updates: Record<string, string>,
  demoMode: boolean,
): {
  filteredUpdates: Partial<Record<ConfigKey, string>>;
  rejectedKeys: string[];
} {
  const filteredUpdates: Partial<Record<ConfigKey, string>> = {};
  const rejectedKeys: string[] = [];
  const whitelist = new Set<ConfigKey>(importableInternalSettingKeys);

  for (const [key, value] of Object.entries(updates)) {
    const configKey = key as ConfigKey;

    if (
      demoMode &&
      whitelist.has(configKey) &&
      demoLockedSettingKeys.has(configKey)
    ) {
      rejectedKeys.push(key);
      continue;
    }

    if (whitelist.has(configKey)) {
      filteredUpdates[configKey] = value;
    } else {
      rejectedKeys.push(key);
    }
  }

  return {
    filteredUpdates,
    rejectedKeys,
  };
}
