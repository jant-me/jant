import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WRANGLER_MAX_BUFFER, runLocalWrangler } from "./wrangler-cli.js";
import { extractWranglerJson } from "./wrangler-json.js";

const DEFAULT_RETRY_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 500;

/**
 * Byte ceiling for a statement batch sent as one `--command=` argument.
 *
 * Linux caps a single argv entry at 128 KiB (`MAX_ARG_STRLEN`) and fails the
 * spawn with `E2BIG`; macOS has no per-argument cap, so an oversized batch
 * works on a developer's Mac and dies in CI and in the demo rebuild, which is
 * exactly how it first surfaced — a snapshot import whose `db.sql` had grown
 * past the limit. Anything at or above this goes through `--file` instead.
 */
const MAX_INLINE_COMMAND_BYTES = 96 * 1024;

function getD1Flag(runtime) {
  return runtime === "d1-remote" ? "--remote" : "--local";
}

function appendWranglerContext(args, options = {}) {
  if (options.configPath) {
    args.push("--config", options.configPath);
  }

  if (options.env) {
    args.push("--env", options.env);
  }

  if (options.persistTo) {
    args.push("--persist-to", options.persistTo);
  }

  return args;
}

function commandArgument(sql) {
  // Inline the value so SQL that starts with `--` comments is not parsed as
  // additional CLI flags by Wrangler's argument parser.
  return `--command=${sql}`;
}

export function parseWranglerError(output) {
  if (!output) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(extractWranglerJson(output).trim());
    const error = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
    if (!error?.text) {
      return undefined;
    }

    const notes = Array.isArray(error.notes)
      ? error.notes
          .map((note) => note?.text)
          .filter((text) => typeof text === "string" && text.length > 0)
      : [];
    const suffix = notes.length > 0 ? ` (${notes.join(" | ")})` : "";
    return `${error.text}${suffix}`;
  } catch {
    return undefined;
  }
}

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const WRANGLER_OUTPUT_EXCERPT_LENGTH = 2000;

/**
 * Rows per read when dumping a D1 table: small enough that a page of long
 * posts stays well inside {@link WRANGLER_MAX_BUFFER}.
 */
export const D1_DUMP_PAGE_SIZE = 200;

/**
 * Say why a Wrangler call failed without echoing its whole output: on a
 * failed `d1 execute` that output can be a site's rows, hundreds of KB of it.
 *
 * @param {string[]} args - The Wrangler arguments
 * @param {Error & { code?: string, stdout?: string, stderr?: string }} error
 * @returns {string} A message naming the command and the cause
 * @example
 * describeWranglerFailure(["d1", "execute", "DB"], enobufsError);
 * // "`wrangler d1 execute DB` printed more than 67108864 bytes, …"
 */
export function describeWranglerFailure(args, error) {
  const command = `wrangler ${args.slice(0, 3).join(" ")}`;
  if (error?.code === "ENOBUFS") {
    return `\`${command}\` printed more than ${WRANGLER_MAX_BUFFER} bytes, the most the CLI buffers.`;
  }

  const stderr = String(error?.stderr ?? "").trim();
  if (stderr) return `\`${command}\` failed: ${stderr}`;

  const stdout = String(error?.stdout ?? "").trim();
  if (stdout) {
    const excerpt =
      stdout.length > WRANGLER_OUTPUT_EXCERPT_LENGTH
        ? `${stdout.slice(0, WRANGLER_OUTPUT_EXCERPT_LENGTH)}… (${stdout.length} characters)`
        : stdout;
    return `\`${command}\` failed: ${excerpt}`;
  }

  return `\`${command}\` failed: ${error?.message ?? "unknown error"}`;
}

export function isRetryableWranglerD1Failure(output, error) {
  const combined = `${output ?? ""}\n${error?.message ?? ""}`.toLowerCase();
  return [
    "timed out",
    "network connection lost",
    "fetch failed",
    "socket hang up",
    "econnreset",
    "etimedout",
    "temporarily unavailable",
    "temporary failure",
  ].some((fragment) => combined.includes(fragment));
}

function getWranglerExecutionOptions(options) {
  const executionOptions = { ...options };
  for (const key of [
    "configPath",
    "database",
    "env",
    "persistTo",
    "quiet",
    "retryAttempts",
    "retryDelayMs",
    "trackedExecution",
  ]) {
    delete executionOptions[key];
  }
  return executionOptions;
}

function runWrangler(args, options = {}) {
  const retryAttempts = Math.max(
    1,
    Number(options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS),
  );
  const retryDelayMs = Math.max(
    0,
    Number(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS),
  );

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      return runLocalWrangler(args, getWranglerExecutionOptions(options));
    } catch (error) {
      const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
      const wranglerError = parseWranglerError(output);
      const retryable = isRetryableWranglerD1Failure(output, error);

      if (retryable && attempt < retryAttempts) {
        console.warn(
          `Transient Wrangler D1 failure (${attempt}/${retryAttempts}) for ${args.slice(0, 4).join(" ")}. Retrying...`,
        );
        sleepSync(retryDelayMs * attempt);
        continue;
      }

      if (wranglerError) {
        throw new Error(`Wrangler error: ${wranglerError}`);
      }

      throw new Error(describeWranglerFailure(args, error), { cause: error });
    }
  }
}

/**
 * Whether a statement batch is too large to travel as one CLI argument.
 *
 * @param {string} sql - SQL batch about to be sent to Wrangler
 * @returns {boolean} true when it has to go through a file instead
 * @example
 * ```js
 * exceedsInlineCommandLimit("SELECT 1;"); // false
 * ```
 */
export function exceedsInlineCommandLimit(sql) {
  return Buffer.byteLength(sql, "utf8") >= MAX_INLINE_COMMAND_BYTES;
}

function withTemporarySqlFile(sql, run) {
  const directory = mkdtempSync(join(tmpdir(), "jant-d1-"));
  try {
    const filePath = join(directory, "batch.sql");
    writeFileSync(filePath, sql);
    return run(filePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function executeD1(sql, runtime, options = {}) {
  if (exceedsInlineCommandLimit(sql)) {
    return withTemporarySqlFile(sql, (filePath) =>
      executeD1File(filePath, runtime, options),
    );
  }

  const args = appendWranglerContext(
    [
      "d1",
      "execute",
      options.database ?? "DB",
      getD1Flag(runtime),
      commandArgument(sql),
    ],
    options,
  );

  if (options.quiet) {
    const output = runWrangler([...args, "--json"], options);
    const parsed = JSON.parse(extractWranglerJson(output));
    const statements = Array.isArray(parsed) ? parsed : [parsed];

    for (const statement of statements) {
      if (statement?.error?.text) {
        throw new Error(`Wrangler error: ${statement.error.text}`);
      }
    }

    return statements;
  }

  runWrangler(args, { ...options, stdio: "inherit" });
}

export function queryD1(sql, runtime, options = {}) {
  const output = runWrangler(
    appendWranglerContext(
      [
        "d1",
        "execute",
        options.database ?? "DB",
        getD1Flag(runtime),
        commandArgument(sql),
        "--json",
      ],
      options,
    ),
    options,
  );
  const parsed = JSON.parse(extractWranglerJson(output));
  const statement = Array.isArray(parsed) ? parsed[0] : parsed;

  if (statement?.error?.text) {
    throw new Error(`Wrangler error: ${statement.error.text}`);
  }

  return statement?.results ?? [];
}

export function executeD1File(filePath, runtime, options = {}) {
  const args = appendWranglerContext(
    [
      "d1",
      "execute",
      options.database ?? "DB",
      getD1Flag(runtime),
      "--file",
      filePath,
    ],
    options,
  );

  if (options.quiet) {
    const output = runWrangler([...args, "--json"], options);
    const parsed = JSON.parse(extractWranglerJson(output));
    const statements = Array.isArray(parsed) ? parsed : [parsed];

    for (const statement of statements) {
      if (statement?.error?.text) {
        throw new Error(`Wrangler error: ${statement.error.text}`);
      }
    }

    return statements;
  }

  runWrangler(args, { ...options, stdio: "inherit" });
}
