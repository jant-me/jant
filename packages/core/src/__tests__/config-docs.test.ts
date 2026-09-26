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
 * one added to `Bindings` has to be documented or declared internal.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { editableSettingKeys } from "../lib/api-settings.js";
import { RESERVED_PATHS } from "../lib/constants.js";
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
  "HOST",
  "INTERNAL_ADMIN_TOKEN",
  "LOCAL_PUBLIC_URL",
  "LOCAL_STORAGE_PATH",
  "PORT",
  "RATE_LIMIT_DISABLED",
  "RATE_LIMIT_SEARCH_PER_MIN",
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

  it("mentions every public variable and setting in configuration.md", () => {
    const markdown = readRepoFile("docs/configuration.md");
    const missing = [...publicConfigKeys, ...PUBLIC_ENV_OUTSIDE_CONFIG_FIELDS]
      .filter((key) => !new RegExp(`\\b${key}\\b`).test(markdown))
      .sort();
    expect(missing).toEqual([]);
  });

  for (const path of CONFIGURATION_DOCS) {
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
});
