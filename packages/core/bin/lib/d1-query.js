import { runLocalWrangler } from "./wrangler-cli.js";
import { extractWranglerJson } from "./wrangler-json.js";

const DEFAULT_RETRY_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 500;

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

      throw new Error(output || error.message, { cause: error });
    }
  }
}

export function executeD1(sql, runtime, options = {}) {
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
