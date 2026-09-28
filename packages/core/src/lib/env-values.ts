/**
 * Environment values
 *
 * The one reader for a setting's environment variable, and the startup check
 * that names every environment value Jant can't use.
 *
 * A setting the dashboard can also change is checked by the rules the
 * dashboard applies (`normalizeEditableSettingValue`) and read back in the
 * form the dashboard stores. `PUBLIC_API_ENABLED=TRUE` therefore means what
 * `true` means, both where the site acts on it and where `GET /api/settings`
 * reports it. An environment-only variable is checked by its rule in
 * `ENV_RULES`.
 */

import { CONFIG_FIELDS, type ConfigKey } from "../types/config.js";
import {
  checkEnvValue,
  ENV_RULES,
  getEnvString,
  hasEnvRule,
  type EnvValueCheck,
} from "./env.js";
import { ValidationError } from "./errors.js";
import { normalizeEditableSettingValue } from "./schemas.js";

type EnvSource = object | undefined | null;

/** An environment variable holding a value Jant can't use. */
export interface EnvValueIssue {
  variable: string;
  message: string;
}

function checkConfigEnvValue(
  key: ConfigKey,
  variable: string,
  raw: string,
): EnvValueCheck {
  const field = CONFIG_FIELDS[key];
  if ("editor" in field) {
    try {
      return { ok: true, value: normalizeEditableSettingValue(key, raw) };
    } catch (error) {
      if (error instanceof ValidationError) {
        return { ok: false, message: error.message };
      }
      throw error;
    }
  }
  return hasEnvRule(variable)
    ? checkEnvValue(variable, raw)
    : { ok: true, value: raw };
}

function configEnvKeys(key: ConfigKey): readonly string[] {
  const field = CONFIG_FIELDS[key];
  return "envKeys" in field ? field.envKeys : [];
}

/**
 * A setting's value from the environment, in the form the dashboard stores.
 *
 * @param env - Runtime environment bindings
 * @param key - The setting
 * @returns The first of its variables that is set, normalized; `undefined`
 *   when none is set or the value is one the startup check reports
 * @example
 * ```ts
 * readConfigEnvValue({ PUBLIC_API_ENABLED: "TRUE" }, "PUBLIC_API_ENABLED");
 * // "true"
 * ```
 */
export function readConfigEnvValue(
  env: EnvSource,
  key: ConfigKey,
): string | undefined {
  for (const variable of configEnvKeys(key)) {
    const raw = getEnvString(env, variable)?.trim();
    if (!raw) continue;
    const checked = checkConfigEnvValue(key, variable, raw);
    return checked.ok ? checked.value : undefined;
  }
  return undefined;
}

function issue(variable: string, raw: string, message: string): EnvValueIssue {
  return { variable, message: `${variable} can't be "${raw}". ${message}` };
}

/**
 * Every environment value Jant can't use: a setting's variable the dashboard
 * would refuse, and an environment-only variable outside its rule.
 *
 * @param env - Runtime environment bindings
 * @returns One issue per variable, in no particular order; empty when all
 *   values are usable
 * @example
 * ```ts
 * getEnvValueIssues({ PAGE_SIZE: "500" });
 * // [{ variable: "PAGE_SIZE", message: 'PAGE_SIZE can\'t be "500". …' }]
 * ```
 */
export function getEnvValueIssues(env: EnvSource): EnvValueIssue[] {
  // The check runs before every request; bindings don't change while a
  // Worker isolate or a Node process lives, so one answer per object serves.
  if (env) {
    const cached = issuesByEnv.get(env);
    if (cached) return cached;
  }
  const issues = collectEnvValueIssues(env);
  if (env) issuesByEnv.set(env, issues);
  return issues;
}

const issuesByEnv = new WeakMap<object, EnvValueIssue[]>();

function collectEnvValueIssues(env: EnvSource): EnvValueIssue[] {
  const issues: EnvValueIssue[] = [];
  const checked = new Set<string>();

  for (const key of Object.keys(CONFIG_FIELDS) as ConfigKey[]) {
    for (const variable of configEnvKeys(key)) {
      checked.add(variable);
      const raw = getEnvString(env, variable)?.trim();
      if (!raw) continue;
      const result = checkConfigEnvValue(key, variable, raw);
      if (!result.ok) issues.push(issue(variable, raw, result.message));
    }
  }

  for (const variable of Object.keys(ENV_RULES)) {
    if (checked.has(variable) || !hasEnvRule(variable)) continue;
    const raw = getEnvString(env, variable)?.trim();
    if (!raw) continue;
    const result = checkEnvValue(variable, raw);
    if (!result.ok) issues.push(issue(variable, raw, result.message));
  }

  return issues;
}
