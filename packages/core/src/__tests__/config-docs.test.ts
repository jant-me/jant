/**
 * The configuration docs describe the configuration the code reads.
 *
 * Environment variables, settings keys, and reserved paths are part of the
 * compatibility promise, and each lives in code: `CONFIG_FIELDS`, the
 * `Bindings` interface, `RESERVED_PATHS`. The docs drifted from all three —
 * `CJK_SERIF_FONT` stayed documented for months after it was removed,
 * `CORS_ORIGINS` and the rate-limit variables were never documented, and the
 * reserved path list missed `subscribe` and `skill.md`, which a post slug can
 * now collide with. These checks fail on each of those.
 *
 * Environment variables outside `CONFIG_FIELDS` are classified here, so a new
 * one added to `Bindings` has to be documented or declared internal, and a
 * variable the code reads has to be in `Bindings` to be classified at all.
 * Both language versions of the reference are held to the same lists, and to
 * the four defaults `docs/compatibility.md` freezes.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  editableSettingKeys,
  importableInternalSettingKeys,
} from "../lib/api-settings.js";
import { RESERVED_PATHS } from "../lib/constants.js";
import { ENV_RULES, getCorsOrigins } from "../lib/env.js";
import { CONFIG_FIELDS } from "../types/config.js";

const CORE_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(CORE_DIR, "../..");
const CONFIGURATION_DOCS = [
  "docs/configuration.md",
  "docs/zh-Hans/configuration.md",
];

/** Environment variables a self-hosted site may set that `CONFIG_FIELDS` doesn't hold. */
const PUBLIC_ENV_OUTSIDE_CONFIG_FIELDS = [
  "CORS_ORIGINS",
  "DATABASE_URL",
  "DATA_DIR",
  "DISCOVER_PING_URL",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_SLUG",
  "GITHUB_APP_WEBHOOK_SECRET",
  "HOST",
  "INTERNAL_ADMIN_TOKEN",
  // Read by the CLI and `jant start`, not the server.
  "JANT_ENV_FILE",
  "LOCAL_PUBLIC_URL",
  "LOCAL_STORAGE_PATH",
  "PORT",
  "RATE_LIMIT_ENABLED",
  "RATE_LIMIT_SEARCH_PER_MIN",
  "TELEGRAM_BOT_TOKENS",
  "TELEGRAM_WEBHOOK_SECRET",
  "TRUST_PROXY",
];

/**
 * `Bindings` members that are not documented settings: platform bindings,
 * values the runtime sets itself, development-only tokens, and the hosted
 * service's configuration.
 */
const INTERNAL_BINDINGS = [
  "DB",
  "R2",
  "NODE_DATABASE",
  "NODE_SQLITE",
  "NODE_STARTED_AT",
  "DEV_API_TOKEN",
  "SITE_RESOLUTION_MODE",
  "HOSTED_CONTROL_PLANE_BASE_URL",
  "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET",
  "HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL",
  "HOSTED_CONTROL_PLANE_INTERNAL_TOKEN",
  "HOSTED_CONTROL_PLANE_PROVIDER_NAME",
  "HOSTED_CONTROL_PLANE_SSO_SECRET",
];

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function readBindingKeys(): string[] {
  const source = readFileSync(join(CORE_DIR, "src/types/bindings.ts"), "utf8");
  return [...source.matchAll(/^\s+([A-Z][A-Z0-9_]+)\??:/gm)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

/** Names in the first cell of every Markdown table row, e.g. `| `PAGE_SIZE` | … |`. */
function readTableKeys(markdown: string): string[] {
  return [...markdown.matchAll(/^\| `([A-Z][A-Z0-9_]+)`/gm)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

function readReservedPaths(markdown: string): string[] {
  const section = markdown
    .split(/^## /m)
    .find((part) => /^(Reserved paths|保留路径)\n/.test(part));
  const block = section?.match(/```text\n([\s\S]*?)```/)?.[1] ?? "";
  return block
    .split(/[,\s]+/)
    .map((path) => path.trim())
    .filter(Boolean);
}

/**
 * Every environment variable a source file names through the env readers:
 * `getEnvString(env, "NAME")`, `readEnvBoolean(env, "NAME")`, and the like.
 */
function readEnvReads(): Map<string, string> {
  const reads = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(
        /\b(?:getEnvString|readEnvBoolean|readEnvInteger|readEnvEnum)\([^,()]+,\s*"([A-Z][A-Z0-9_]+)"/g,
      )) {
        if (match[1]) reads.set(match[1], relative(CORE_DIR, path));
      }
    }
  };
  walk(join(CORE_DIR, "src"));
  return reads;
}

/**
 * Defaults `docs/compatibility.md` freezes until a major release: each decides
 * what a covered address answers.
 */
const FROZEN_DEFAULTS = {
  PUBLIC_API_ENABLED: "true",
  MAIN_RSS_FEED: "featured",
  RSS_FEEDS_ENABLED: "true",
  CORS_ORIGINS: "*",
} as const;

/** The default a configuration doc's table gives a variable, e.g. `` `true` ``. */
function readTableDefault(markdown: string, key: string): string | undefined {
  const row = markdown.match(
    new RegExp(`^\\| \`${key}\`\\s*\\| \`([^\`]*)\`\\s*\\|`, "m"),
  );
  return row?.[1];
}

const configKeys = Object.keys(CONFIG_FIELDS);
const publicConfigKeys = Object.entries(CONFIG_FIELDS)
  .filter(([, field]) => !("internal" in field && field.internal))
  .map(([key]) => key);

describe("configuration docs", () => {
  it("classifies every Bindings variable", () => {
    const known = new Set([
      ...configKeys,
      ...PUBLIC_ENV_OUTSIDE_CONFIG_FIELDS,
      ...INTERNAL_BINDINGS,
    ]);
    expect(readBindingKeys().filter((key) => !known.has(key))).toEqual([]);
  });

  it("declares in Bindings every variable the code reads", () => {
    const bindings = new Set(readBindingKeys());
    const undeclared = [...readEnvReads()]
      .filter(([key]) => !bindings.has(key))
      .map(([key, file]) => `${key} (${file})`);
    const unruled = Object.keys(ENV_RULES).filter((key) => !bindings.has(key));
    expect([...undeclared, ...unruled]).toEqual([]);
  });

  it("keeps the frozen defaults", () => {
    expect(CONFIG_FIELDS.PUBLIC_API_ENABLED.defaultValue).toBe(
      FROZEN_DEFAULTS.PUBLIC_API_ENABLED,
    );
    expect(CONFIG_FIELDS.MAIN_RSS_FEED.defaultValue).toBe(
      FROZEN_DEFAULTS.MAIN_RSS_FEED,
    );
    expect(CONFIG_FIELDS.RSS_FEEDS_ENABLED.defaultValue).toBe(
      FROZEN_DEFAULTS.RSS_FEEDS_ENABLED,
    );
    expect(getCorsOrigins({})).toBe(FROZEN_DEFAULTS.CORS_ORIGINS);
  });

  for (const path of CONFIGURATION_DOCS) {
    it(`${path} mentions every public variable and setting`, () => {
      const markdown = readRepoFile(path);
      const missing = [...publicConfigKeys, ...PUBLIC_ENV_OUTSIDE_CONFIG_FIELDS]
        .filter((key) => !new RegExp(`\\b${key}\\b`).test(markdown))
        .sort();
      expect(missing).toEqual([]);
    });

    it(`${path} gives the frozen defaults`, () => {
      const markdown = readRepoFile(path);
      for (const [key, value] of Object.entries(FROZEN_DEFAULTS)) {
        expect(readTableDefault(markdown, key), key).toBe(value);
      }
    });

    it(`${path} lists exactly the settings the Settings pages edit`, () => {
      const section =
        readRepoFile(path)
          .split(/^## /m)
          .find((part) =>
            /^(Settings page options|Settings 页面设置)\n/.test(part),
          ) ?? "";
      const table = section.split(/^### /m)[0] ?? "";
      // DISCOVER is set on the General page but kept out of the Config Editor,
      // so "never chosen" can stay distinct from "off".
      expect(readTableKeys(table).sort()).toEqual(
        [...editableSettingKeys, "DISCOVER"].sort(),
      );
    });

    it(`${path} lists no variable the code doesn't read`, () => {
      const known = new Set([
        ...configKeys,
        ...PUBLIC_ENV_OUTSIDE_CONFIG_FIELDS,
      ]);
      const unknown = readTableKeys(readRepoFile(path)).filter(
        (key) => !known.has(key),
      );
      expect(unknown).toEqual([]);
    });

    it(`${path} lists exactly the reserved paths`, () => {
      expect(readReservedPaths(readRepoFile(path)).sort()).toEqual(
        [...RESERVED_PATHS].sort(),
      );
    });
  }

  it("lists exactly the editable setting keys in API.md", () => {
    const markdown = readRepoFile("docs/API.md");
    const section =
      markdown
        .split(/^### /m)
        .find((part) => part.startsWith("Editable setting keys\n")) ?? "";
    expect(readTableKeys(section).sort()).toEqual(
      [...editableSettingKeys].sort(),
    );
  });

  it("lists exactly the importable setting keys in API.md", () => {
    const markdown = readRepoFile("docs/API.md");
    const section =
      markdown
        .split(/^### /m)
        .find((part) =>
          part.startsWith("Import appearance and language settings\n"),
        ) ?? "";
    expect(readTableKeys(section).sort()).toEqual(
      [...importableInternalSettingKeys].sort(),
    );
  });
});
