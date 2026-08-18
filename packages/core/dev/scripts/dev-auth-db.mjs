import { randomBytes, scryptSync } from "node:crypto";
import { generateKeyBetween } from "fractional-indexing";
import { typeidUnboxed } from "typeid-js";
import { runLocalWrangler } from "../../bin/lib/wrangler-cli.js";
import { extractWranglerJson } from "../../bin/lib/wrangler-json.js";
import {
  DEFAULT_NAVIGATION_PROFILE,
  SYSTEM_NAV_KEYS,
} from "../../src/types/constants.ts";

export const DEV_EMAIL = "debug@jant.test";
export const DEFAULT_DEV_PASSWORD = "jant-dev-debug-login";
export const DEFAULT_SITE_NAME = "Jant";
export const DEFAULT_SITE_LANGUAGE = "en";

export const DEFAULT_NAVIGATION_SEED_ITEMS = Object.freeze(
  DEFAULT_NAVIGATION_PROFILE.systemKeys.map((systemKey) =>
    Object.freeze({
      systemKey,
      label: "",
      url: SYSTEM_NAV_KEYS[systemKey].url,
      placement: SYSTEM_NAV_KEYS[systemKey].defaultPlacement,
    }),
  ),
);

const PASSWORD_HASH_PREFIX = "custom-scrypt";
const PASSWORD_HASH_N = 16_384;
const PASSWORD_HASH_R = 16;
const PASSWORD_HASH_P = 1;
const PASSWORD_HASH_KEY_LENGTH = 64;
const PASSWORD_HASH_SALT_BYTES = 16;

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function randomId(byteLength = 16) {
  return randomBytes(byteLength).toString("hex");
}

function createTypeId(prefix) {
  return typeidUnboxed(prefix);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function runWrangler(args, options = {}) {
  return runLocalWrangler(["d1", "execute", "DB", ...args], {
    encoding: "utf-8",
    ...options,
  });
}

export function executeJson(flag, sql) {
  const stdout = runWrangler([flag, "--command", sql, "--json"]);
  return JSON.parse(extractWranglerJson(stdout));
}

export function executeSql(flag, sql) {
  runWrangler([flag, "--command", sql], { stdio: "inherit" });
}

export async function hashPassword(password) {
  const saltHex = randomBytes(PASSWORD_HASH_SALT_BYTES).toString("hex");
  const derivedKey = scryptSync(
    password.normalize("NFKC"),
    saltHex,
    PASSWORD_HASH_KEY_LENGTH,
    {
      N: PASSWORD_HASH_N,
      r: PASSWORD_HASH_R,
      p: PASSWORD_HASH_P,
      maxmem: 128 * PASSWORD_HASH_N * PASSWORD_HASH_R * 2,
    },
  );

  return [
    PASSWORD_HASH_PREFIX,
    String(PASSWORD_HASH_N),
    String(PASSWORD_HASH_R),
    String(PASSWORD_HASH_P),
    String(PASSWORD_HASH_KEY_LENGTH),
    saltHex,
    bytesToHex(derivedKey),
  ].join("$");
}

function getCredentialUsers(flag) {
  const result = executeJson(
    flag,
    [
      "SELECT user.id AS user_id, user.name, user.email, user.role,",
      "account.id AS account_row_id",
      "FROM user",
      "JOIN account ON account.user_id = user.id",
      "WHERE account.provider_id = 'credential'",
      "ORDER BY CASE WHEN user.role = 'admin' THEN 0 ELSE 1 END, user.created_at ASC",
    ].join(" "),
  );

  return result[0]?.results ?? [];
}

function getSingleSite(flag) {
  const result = executeJson(
    flag,
    [
      "SELECT id, key, status, created_at AS createdAt, updated_at AS updatedAt",
      "FROM site",
      "ORDER BY created_at ASC",
      "LIMIT 2",
    ].join(" "),
  );

  const rows = result[0]?.results ?? [];

  if (rows.length > 1) {
    console.error(
      [
        "Local debug auth helpers only support single-site instances.",
        "This database contains multiple sites. Use site-aware runtime setup instead.",
      ].join("\n"),
    );
    process.exit(1);
  }

  return rows[0] ?? null;
}

function getSettingMap(flag, siteId) {
  const result = executeJson(
    flag,
    [
      "SELECT key, value FROM site_setting",
      "WHERE key IN ('ONBOARDING_STATUS', 'SITE_NAME', 'SITE_LANGUAGE')",
      `AND site_id = ${sqlString(siteId)}`,
    ].join(" "),
  );

  return Object.fromEntries(
    (result[0]?.results ?? []).map((row) => [row.key, row.value]),
  );
}

function getOrderedNavPositions(flag, siteId) {
  const result = executeJson(
    flag,
    [
      "SELECT position",
      "FROM nav_item",
      `WHERE site_id = ${sqlString(siteId)}`,
      "ORDER BY position",
    ].join(" "),
  );

  return result[0]?.results ?? [];
}

function getExistingSystemNavKeys(flag, siteId) {
  const result = executeJson(
    flag,
    [
      "SELECT system_key AS systemKey",
      "FROM nav_item",
      `WHERE site_id = ${sqlString(siteId)} AND system_key IS NOT NULL`,
    ].join(" "),
  );

  return new Set(
    (result[0]?.results ?? []).flatMap((row) =>
      row.systemKey ? [row.systemKey] : [],
    ),
  );
}

function buildDefaultNavInsertStatements(flag, siteId, timestamp) {
  const existingKeys = getExistingSystemNavKeys(flag, siteId);
  const positions = getOrderedNavPositions(flag, siteId);
  let lastPosition = positions.at(-1)?.position ?? null;

  const statements = [];
  let seededNavigation = false;

  for (const item of DEFAULT_NAVIGATION_SEED_ITEMS) {
    if (existingKeys.has(item.systemKey)) continue;

    const position = generateKeyBetween(lastPosition, null);
    statements.push(
      [
        "INSERT INTO nav_item (id, site_id, type, system_key, label, url, placement, position, created_at, updated_at)",
        "VALUES (",
        `${sqlString(createTypeId("nav"))}, ${sqlString(siteId)}, 'system', ${sqlString(item.systemKey)}, ${sqlString(item.label)}, ${sqlString(item.url)}, ${sqlString(item.placement)}, ${sqlString(position)}, ${timestamp}, ${timestamp}`,
        ")",
      ].join(" "),
    );

    lastPosition = position;
    existingKeys.add(item.systemKey);
    seededNavigation = true;
  }

  return { statements, seededNavigation };
}

function ensureSingleSiteShell(flag, timestamp) {
  const existingSite = getSingleSite(flag);
  if (existingSite) {
    return {
      siteId: existingSite.id,
      createdSite: false,
      statements: [],
    };
  }

  const siteId = createTypeId("sit");
  return {
    siteId,
    createdSite: true,
    statements: [
      [
        "INSERT INTO site (id, key, status, created_at, updated_at)",
        "VALUES (",
        `${sqlString(siteId)}, 'default', 'active', ${timestamp}, ${timestamp}`,
        ")",
      ].join(" "),
    ],
  };
}

export async function setCredentialPassword({
  password,
  flag,
  email,
  allowMissingAdmin = false,
  missingAdminMessage = [
    "No credential user found in the database.",
    "Run the matching bootstrap command before setting credentials.",
  ].join("\n"),
}) {
  const credentialUsers = getCredentialUsers(flag);
  const targetUser = credentialUsers[0];

  if (!targetUser) {
    if (allowMissingAdmin) {
      console.warn(missingAdminMessage);
      return { updated: false };
    }

    console.error(missingAdminMessage);
    process.exit(1);
  }

  const hashedPassword = await hashPassword(password);
  const timestamp = nowSeconds();
  const statements = [
    [
      "UPDATE user",
      `SET email = ${sqlString(email)}, role = 'admin', updated_at = ${timestamp}`,
      `WHERE id = ${sqlString(targetUser.user_id)}`,
    ].join(" "),
    [
      "UPDATE account",
      `SET password = ${sqlString(hashedPassword)}, updated_at = ${timestamp}`,
      `WHERE id = ${sqlString(targetUser.account_row_id)}`,
    ].join(" "),
  ];

  executeSql(flag, statements.join("; "));

  return {
    updated: true,
    promotedToAdmin: targetUser.role !== "admin",
    previousEmail: targetUser.email,
  };
}

export async function ensureManagedSetup({
  password,
  flag,
  email,
  siteName = DEFAULT_SITE_NAME,
  siteLanguage = DEFAULT_SITE_LANGUAGE,
  missingAdminMessage = [
    "No credential user found in the database.",
    "Run the matching bootstrap command before setting credentials.",
  ].join("\n"),
}) {
  const timestamp = nowSeconds();
  const shell = ensureSingleSiteShell(flag, timestamp);
  const siteId = shell.siteId;
  const settings = getSettingMap(flag, siteId);
  const credentialUsers = getCredentialUsers(flag);
  const statements = [...shell.statements];

  let createdCredentialUser = false;
  let ensuredSiteMembership = false;
  const completedOnboarding = settings.ONBOARDING_STATUS !== "completed";
  let ownerUserId = credentialUsers[0]?.user_id ?? null;

  if (credentialUsers.length === 0) {
    const userId = createTypeId("usr");
    const accountId = createTypeId("acc");
    const hashedPassword = await hashPassword(password);
    ownerUserId = userId;

    statements.push(
      [
        "INSERT INTO user (id, name, email, email_verified, image, role, created_at, updated_at)",
        "VALUES (",
        `${sqlString(userId)}, ${sqlString(siteName)}, ${sqlString(email)}, 0, NULL, 'admin', ${timestamp}, ${timestamp}`,
        ")",
      ].join(" "),
    );
    statements.push(
      [
        "INSERT INTO account (",
        "id, account_id, provider_id, user_id, access_token, refresh_token, id_token,",
        "access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at",
        ") VALUES (",
        `${sqlString(accountId)}, ${sqlString(userId)}, 'credential', ${sqlString(userId)}, NULL, NULL, NULL, NULL, NULL, NULL, ${sqlString(hashedPassword)}, ${timestamp}, ${timestamp}`,
        ")",
      ].join(" "),
    );

    createdCredentialUser = true;
  }

  let seededNavigation = false;
  if (completedOnboarding) {
    const navSeed = buildDefaultNavInsertStatements(flag, siteId, timestamp);
    statements.push(...navSeed.statements);
    seededNavigation = navSeed.seededNavigation;
  }

  if (ownerUserId) {
    statements.push(
      [
        "INSERT INTO site_member (site_id, user_id, role, created_at, updated_at) VALUES",
        `(${sqlString(siteId)}, ${sqlString(ownerUserId)}, 'owner', ${timestamp}, ${timestamp})`,
        "ON CONFLICT(site_id, user_id) DO UPDATE SET role = 'owner', updated_at = excluded.updated_at",
      ].join(" "),
    );
    ensuredSiteMembership = true;
  }

  if (!settings.SITE_NAME) {
    statements.push(
      [
        "INSERT INTO site_setting (site_id, key, value, updated_at) VALUES",
        `(${sqlString(siteId)}, 'SITE_NAME', ${sqlString(siteName)}, ${timestamp})`,
        "ON CONFLICT(site_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ].join(" "),
    );
  }

  if (!settings.SITE_LANGUAGE) {
    statements.push(
      [
        "INSERT INTO site_setting (site_id, key, value, updated_at) VALUES",
        `(${sqlString(siteId)}, 'SITE_LANGUAGE', ${sqlString(siteLanguage)}, ${timestamp})`,
        "ON CONFLICT(site_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ].join(" "),
    );
  }

  if (settings.ONBOARDING_STATUS !== "completed") {
    statements.push(
      [
        "INSERT INTO site_setting (site_id, key, value, updated_at) VALUES",
        `(${sqlString(siteId)}, 'ONBOARDING_STATUS', 'completed', ${timestamp})`,
        "ON CONFLICT(site_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ].join(" "),
    );
  }

  if (statements.length > 0) {
    executeSql(flag, statements.join("; "));
  }

  const passwordResult = await setCredentialPassword({
    password,
    flag,
    email,
    allowMissingAdmin: false,
    missingAdminMessage,
  });

  return {
    createdSite: shell.createdSite,
    createdCredentialUser,
    ensuredSiteMembership,
    completedOnboarding,
    seededNavigation,
    promotedToAdmin: passwordResult.promotedToAdmin ?? false,
  };
}

export async function setLocalDevPassword({
  password,
  flag,
  allowMissingAdmin = false,
}) {
  return setCredentialPassword({
    password,
    flag,
    email: DEV_EMAIL,
    allowMissingAdmin,
    missingAdminMessage: [
      "No credential user found in the local database.",
      "Run `mise run dev-auth-bootstrap` to bootstrap a local debug account.",
    ].join("\n"),
  });
}

export async function ensureLocalDevSetup({
  password,
  flag,
  siteName = DEFAULT_SITE_NAME,
}) {
  return ensureManagedSetup({
    password,
    flag,
    email: DEV_EMAIL,
    siteName,
    siteLanguage: DEFAULT_SITE_LANGUAGE,
    missingAdminMessage: [
      "No credential user found in the local database.",
      "Run `mise run dev-auth-bootstrap` to bootstrap a local debug account.",
    ].join("\n"),
  });
}
