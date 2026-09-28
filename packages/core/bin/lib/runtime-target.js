import { autoloadNodeEnv } from "./node-env.js";
import { resolveDatabaseDialect } from "./node-sqlite.js";

export function resolveCliRuntime(values, env = process.env) {
  const flags = [values.local, values.remote, values.node].filter(Boolean);
  if (flags.length > 1) {
    throw new Error("Choose only one of --local, --remote, or --node.");
  }

  if (values.remote) {
    return "d1-remote";
  }

  if (values.local) {
    return "d1-local";
  }

  if (values.node) {
    return "node";
  }

  if (
    (typeof env.DATABASE_URL === "string" && env.DATABASE_URL.length > 0) ||
    (typeof env.DATA_DIR === "string" && env.DATA_DIR.length > 0)
  ) {
    return "node";
  }

  return "d1-local";
}

export function getCliRuntimeLabel(runtime) {
  switch (runtime) {
    case "d1-remote":
      return "remote D1";
    case "d1-local":
      return "local D1";
    default:
      return "Node database";
  }
}

function describeNodeTarget(env) {
  const databaseUrl = env.DATABASE_URL;
  if (typeof databaseUrl === "string" && databaseUrl.length > 0) {
    const dialect = resolveDatabaseDialect(databaseUrl);
    if (dialect === "sqlite") {
      return `sqlite ${databaseUrl}`;
    }

    try {
      const parsed = new URL(databaseUrl);
      const protocol = parsed.protocol.replace(/:$/, "");
      const host = parsed.hostname || "?";
      const port = parsed.port ? `:${parsed.port}` : "";
      const database = parsed.pathname.replace(/^\/+/, "") || "?";
      return `${protocol} ${host}${port}/${database}`;
    } catch {
      return "<invalid DATABASE_URL>";
    }
  }

  if (typeof env.DATA_DIR === "string" && env.DATA_DIR.length > 0) {
    return `DATA_DIR=${env.DATA_DIR}`;
  }

  return "<unset>";
}

export function formatRuntimeBanner(runtime, env = process.env) {
  switch (runtime) {
    case "node":
      return `[jant] target = node (${describeNodeTarget(env)})`;
    case "d1-remote":
      return "[jant] target = remote D1 (wrangler)";
    case "d1-local":
    default:
      return "[jant] target = local D1 (wrangler)";
  }
}

/**
 * One-call helper for DB-touching CLI commands:
 *   1. Load the env file (so DATABASE_URL/DATA_DIR work without sourcing).
 *   2. Resolve the runtime from flags and env.
 *   3. Print a one-line banner so the user immediately sees which target
 *      was picked, instead of finding out minutes later when something fails.
 *
 * Pass `{ silent: true }` to suppress the banner (e.g. in tests or when the
 * caller wants to print its own header first).
 */
export function bootstrapCliRuntime(values, options = {}) {
  const env = options.env ?? process.env;
  const envLoad = autoloadNodeEnv(env);
  const runtime = resolveCliRuntime(values, env);

  if (!options.silent) {
    console.log(formatRuntimeBanner(runtime, env));
  }

  return { runtime, envLoad };
}
