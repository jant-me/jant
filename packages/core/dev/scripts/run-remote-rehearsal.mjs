import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const tempDir = mkdtempSync(join(tmpdir(), "jant-remote-rehearsal-"));
const configPath = join(tempDir, "wrangler.toml");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const env = {};
  const lines = readFileSync(filePath, "utf-8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice(7) : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

const fileEnv = {
  ...parseEnvFile(resolve(root, ".env")),
  ...parseEnvFile(resolve(root, ".env.local")),
};
const env = {
  ...fileEnv,
  ...process.env,
};

const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? env.CF_ACCOUNT_ID ?? "";
const databaseId = env.CF_MIGRATION_REHEARSAL_DB_ID ?? "";
const databaseName = env.CF_MIGRATION_REHEARSAL_DB_NAME ?? "";
const fixturePath =
  env.MIGRATION_REHEARSAL_FIXTURE ?? "src/db/rehearsal-fixtures/v0.3.39.json";

if (!accountId) {
  console.error(
    "Missing CLOUDFLARE_ACCOUNT_ID (or legacy CF_ACCOUNT_ID) for remote rehearsal.",
  );
  process.exit(1);
}

if (!databaseId || !databaseName) {
  console.error(
    "Missing CF_MIGRATION_REHEARSAL_DB_ID or CF_MIGRATION_REHEARSAL_DB_NAME for remote rehearsal.",
  );
  process.exit(1);
}

writeFileSync(
  configPath,
  [
    'name = "jant-migration-rehearsal"',
    `main = "${resolve(root, "dev/preview-entry.js")}"`,
    'compatibility_date = "2026-01-20"',
    'compatibility_flags = ["nodejs_compat"]',
    `account_id = "${accountId}"`,
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    `database_name = "${databaseName}"`,
    `database_id = "${databaseId}"`,
    `migrations_dir = "${resolve(root, "src/db/migrations")}"`,
    "",
  ].join("\n"),
);

try {
  execFileSync(
    process.execPath,
    [
      "./bin/jant.js",
      "db",
      "rehearse",
      "--remote",
      "--config",
      configPath,
      "--fixture",
      fixturePath,
    ],
    {
      cwd: root,
      stdio: "inherit",
      env,
    },
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
