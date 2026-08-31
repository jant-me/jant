import { normalizeDisplayText } from "./display-text.js";
import { buildSiteUrl, normalizeSitePathPrefix } from "./url.js";

type EnvSource = object | undefined | null;

export const DEFAULT_APP_PORT = 3000;

/**
 * Jant's own directory.
 *
 * A long-lived public contract: shipped self-hosted versions POST here for
 * years, so it is baked in rather than configured, and it never moves.
 */
export const DEFAULT_DISCOVER_PING_URL = "https://jant.me/api/discover/ping";

function toEnvRecord(env: EnvSource): Record<string, unknown> {
  return (env ?? {}) as Record<string, unknown>;
}

function normalizeEnvScalar(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.length > 0 ? value : undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : undefined;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return undefined;
}

/**
 * Returns the first non-empty environment variable value from `keys`.
 *
 * Callers may provide multiple keys when a single semantic value can be
 * sourced from more than one binding at runtime.
 */
export function getEnvString(
  env: EnvSource,
  ...keys: readonly string[]
): string | undefined {
  const record = toEnvRecord(env);

  for (const key of keys) {
    const value = normalizeEnvScalar(record[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

/**
 * Parse a TCP port from an environment value.
 *
 * @param rawPort - Raw environment value to parse
 * @param fallback - Port to use when `rawPort` is empty
 * @returns The parsed port number
 * @example
 * parsePortValue("3000");
 */
export function parsePortValue(
  rawPort: string | undefined,
  fallback = DEFAULT_APP_PORT,
): number {
  if (!rawPort) {
    return fallback;
  }

  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

/**
 * Resolve the configured application port from environment bindings.
 *
 * @param env - Runtime environment bindings
 * @param fallback - Port to use when `PORT` is not set
 * @returns The resolved application port
 * @example
 * getPort({ PORT: "3000" });
 */
export function getPort(env: EnvSource, fallback = DEFAULT_APP_PORT): number {
  return parsePortValue(getEnvString(env, "PORT"), fallback);
}

export function getSiteOrigin(env: EnvSource): string {
  const configuredOrigin = getEnvString(env, "SITE_ORIGIN");
  return configuredOrigin ? new URL(configuredOrigin).origin : "";
}

export function getSitePathPrefix(env: EnvSource): string {
  const configuredPrefix = getEnvString(env, "SITE_PATH_PREFIX");
  return configuredPrefix ? normalizeSitePathPrefix(configuredPrefix) : "";
}

export function getSiteUrl(env: EnvSource): string {
  return buildSiteUrl(getSiteOrigin(env), getSitePathPrefix(env));
}

export function getConfiguredSingleSiteOrigin(env: EnvSource): string {
  return getSiteResolutionMode(env) === "single-site" ? getSiteOrigin(env) : "";
}

export function getConfiguredSingleSitePathPrefix(env: EnvSource): string {
  return getSiteResolutionMode(env) === "single-site"
    ? getSitePathPrefix(env)
    : "";
}

/**
 * Returns the configured public site URL only when the instance runs in
 * `single-site` mode.
 *
 * @param env - Runtime environment bindings
 * @returns The configured `SITE_ORIGIN` + `SITE_PATH_PREFIX`, or an empty
 * string in `host-based` mode
 * @example
 * getConfiguredSingleSiteUrl({ SITE_ORIGIN: "https://example.com" });
 */
export function getConfiguredSingleSiteUrl(env: EnvSource): string {
  return getSiteResolutionMode(env) === "single-site" ? getSiteUrl(env) : "";
}

export function getSiteResolutionMode(
  env: EnvSource,
): "single-site" | "host-based" {
  return getEnvString(env, "SITE_RESOLUTION_MODE") === "host-based"
    ? "host-based"
    : "single-site";
}

export function getAuthSecret(env: EnvSource): string | undefined {
  return getEnvString(env, "AUTH_SECRET");
}

export function getDevApiToken(env: EnvSource): string | undefined {
  return getEnvString(env, "DEV_API_TOKEN");
}

export function getInternalAdminToken(env: EnvSource): string | undefined {
  return getEnvString(env, "INTERNAL_ADMIN_TOKEN");
}

export function getHostedControlPlaneBaseUrl(
  env: EnvSource,
): string | undefined {
  return getEnvString(env, "HOSTED_CONTROL_PLANE_BASE_URL");
}

export function getHostedControlPlaneDomainCheckSecret(
  env: EnvSource,
): string | undefined {
  return getEnvString(env, "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET");
}

export function getHostedControlPlaneInternalBaseUrl(
  env: EnvSource,
): string | undefined {
  return (
    getEnvString(env, "HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL") ??
    getHostedControlPlaneBaseUrl(env)
  );
}

export function getHostedControlPlaneProviderName(
  env: EnvSource,
): string | undefined {
  return getEnvString(env, "HOSTED_CONTROL_PLANE_PROVIDER_NAME");
}

export function getHostedControlPlaneProviderLabel(
  env: EnvSource,
): string | undefined {
  const configuredName = normalizeDisplayText(
    getHostedControlPlaneProviderName(env),
  );
  if (configuredName) {
    return configuredName;
  }

  const hostedControlPlaneBaseUrl = getHostedControlPlaneBaseUrl(env);
  if (!hostedControlPlaneBaseUrl) {
    return undefined;
  }

  return new URL(hostedControlPlaneBaseUrl).hostname;
}

export function getHostedControlPlaneSsoSecret(
  env: EnvSource,
): string | undefined {
  return getEnvString(env, "HOSTED_CONTROL_PLANE_SSO_SECRET");
}

export function getHostedControlPlaneInternalToken(
  env: EnvSource,
): string | undefined {
  return getEnvString(env, "HOSTED_CONTROL_PLANE_INTERNAL_TOKEN");
}

/**
 * Where a site announces itself when its owner turns Jant Discover on.
 *
 * Read presence-aware rather than through `getEnvString`, because the two
 * states that matter are spelled differently: an **absent** binding means
 * "use Jant's directory", while a binding set to the **empty string** means
 * "announce nowhere". `getEnvString` collapses both into undefined, which
 * would make the documented way of switching the ping off silently fall back
 * to switching it on.
 *
 * @param env - Worker bindings or `process.env`
 * @returns The endpoint to announce to, or undefined when announcing is off
 * @example
 * ```ts
 * getDiscoverPingUrl({}); // the default directory
 * getDiscoverPingUrl({ DISCOVER_PING_URL: "" }); // undefined — off
 * ```
 */
export function getDiscoverPingUrl(env: EnvSource): string | undefined {
  const record = toEnvRecord(env);
  if (Object.hasOwn(record, "DISCOVER_PING_URL")) {
    const configured = normalizeEnvScalar(record["DISCOVER_PING_URL"]);
    return configured?.trim() || undefined;
  }
  return DEFAULT_DISCOVER_PING_URL;
}

export function getStorageDriverEnv(env: EnvSource): string | undefined {
  return getEnvString(env, "STORAGE_DRIVER");
}

export function getDataDir(env: EnvSource): string | undefined {
  return getEnvString(env, "DATA_DIR");
}

function joinDataSubpath(dataDir: string, child: string): string {
  return `${dataDir.replace(/[\\/]+$/, "")}/${child}`;
}

export function getLocalStoragePath(env: EnvSource): string | undefined {
  const explicit = getEnvString(env, "LOCAL_STORAGE_PATH");
  if (explicit) {
    return explicit;
  }

  const dataDir = getDataDir(env);
  return dataDir ? joinDataSubpath(dataDir, "media") : undefined;
}

export function getDefaultStorageDriver(env: EnvSource): "local" | "r2" {
  const record = toEnvRecord(env);
  return record["NODE_SQLITE"] || record["NODE_DATABASE"] ? "local" : "r2";
}

export function getConfiguredStorageDriver(env: EnvSource): string {
  return getStorageDriverEnv(env) ?? getDefaultStorageDriver(env);
}

/**
 * Returns the parsed CORS origins configuration.
 *
 * @param env - Runtime environment bindings
 * @returns `"*"` to allow all origins, an array of allowed origin strings,
 *          or `undefined` when CORS is disabled
 *
 * @example
 * ```ts
 * getCorsOrigins({ CORS_ORIGINS: "*" }); // "*"
 * getCorsOrigins({ CORS_ORIGINS: "https://a.com,chrome-extension://id" });
 * // ["https://a.com", "chrome-extension://id"]
 * getCorsOrigins({}); // "*"
 * ```
 */
export function getCorsOrigins(env: EnvSource): "*" | string[] | undefined {
  const raw = getEnvString(env, "CORS_ORIGINS") ?? "*";
  if (!raw) {
    return undefined;
  }

  if (raw === "*") {
    return "*";
  }

  const origins = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return origins.length > 0 ? origins : undefined;
}

/**
 * GitHub App credentials resolved from environment bindings.
 *
 * Returned only when all three required fields are present. The private key
 * accepts either raw PEM or a PEM with `\n` escape sequences (common in env
 * var tooling); callers receive the normalized PEM.
 */
export interface GitHubAppEnvConfig {
  appId: string;
  privateKey: string;
  slug: string;
  webhookSecret?: string;
}

export function getGitHubAppConfig(env: EnvSource): GitHubAppEnvConfig | null {
  const appId = getEnvString(env, "GITHUB_APP_ID");
  const rawKey = getEnvString(env, "GITHUB_APP_PRIVATE_KEY");
  const slug = getEnvString(env, "GITHUB_APP_SLUG");
  if (!appId || !rawKey || !slug) return null;

  // Allow `\n` escapes (Fly/Workers secrets paste-friendly)
  const privateKey = rawKey.includes("\\n")
    ? rawKey.replace(/\\n/g, "\n")
    : rawKey;

  return {
    appId,
    privateKey,
    slug,
    webhookSecret: getEnvString(env, "GITHUB_APP_WEBHOOK_SECRET"),
  };
}

export function shouldTrustProxy(env: EnvSource): boolean {
  return getEnvString(env, "TRUST_PROXY") === "true";
}

/** A single platform-managed Telegram bot from `TELEGRAM_BOT_TOKENS`. */
export interface TelegramPoolBot {
  /** Numeric bot id — the part before `:` in the token. */
  botId: string;
  /** Full `<bot_id>:<secret>` bot token. */
  token: string;
}

/**
 * Parses the platform-managed Telegram bot pool from `TELEGRAM_BOT_TOKENS`.
 *
 * The env value is a comma-separated list of `<bot_id>:<secret>` tokens. The
 * first entry is the public-facing bot (`bot1`); the rest are surfaced only
 * contextually when a binding code reaches an already-bound bot slot.
 *
 * @param env - Runtime environment bindings
 * @returns Parsed pool bots in declared order; empty when unset/invalid
 * @example
 * getTelegramBotPool({ TELEGRAM_BOT_TOKENS: "111:aaa,222:bbb" });
 */
export function getTelegramBotPool(env: EnvSource): TelegramPoolBot[] {
  const raw = getEnvString(env, "TELEGRAM_BOT_TOKENS");
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((token) => {
      const botId = token.split(":")[0]?.trim() ?? "";
      return { botId, token };
    })
    .filter((bot) => bot.botId.length > 0);
}

/**
 * Returns the shared `secret_token` used when registering every pool bot's
 * webhook. Only meaningful alongside `TELEGRAM_BOT_TOKENS`.
 */
export function getTelegramWebhookSecret(env: EnvSource): string | undefined {
  return getEnvString(env, "TELEGRAM_WEBHOOK_SECRET");
}

export function shouldUseSecureCookies(
  env: EnvSource,
  publicRequestUrl: string,
): boolean {
  const siteOrigin = getConfiguredSingleSiteOrigin(env);
  if (siteOrigin) {
    return new URL(siteOrigin).protocol === "https:";
  }

  return new URL(publicRequestUrl).protocol === "https:";
}
