import { typeidUnboxed } from "typeid-js";

function escapeSqlString(value) {
  return String(value).replaceAll("'", "''");
}

function getOptionalString(row, key) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getRequiredString(row, key) {
  const value = getOptionalString(row, key);
  if (!value) {
    throw new Error(`Site row is missing required ${key}.`);
  }
  return value;
}

function getRequiredNumber(row, key) {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  throw new Error(`Site row is missing required ${key}.`);
}

function normalizePathPrefix(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed === "/") {
    return null;
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/+$/, "");
  return normalized || null;
}

/**
 * Printed when a host-based command names no site. Kept word for word with
 * `resolveCliSite` in `src/runtime/site.ts`, which the Node path uses.
 */
const HOST_BASED_SITE_REQUIRED_MESSAGE =
  "host-based mode needs a target site. Pass --site <key|id>, --host <host>, or --url <url>.";

function getTrimmedOption(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Turn the site flags a command parsed into the selector both resolvers take:
 * this file's raw-SQL `resolveCliSite` and `createNodeCliRuntime`.
 *
 * @param {{ site?: string, host?: string, pathPrefix?: string, url?: string }} [options]
 *   The `--site`, `--host`, `--path-prefix` and `--url` values
 * @returns {{ kind: "site", idOrKey: string } | { kind: "host", host: string, pathPrefix: string | null } | null}
 *   The selector, or null when no site flag was passed
 * @throws {Error} When more than one of `--site`, `--host` and `--url` is set
 * @example
 * parseCliSiteSelector({ url: "https://example.com/blog/" });
 * // { kind: "host", host: "example.com", pathPrefix: "/blog" }
 */
export function parseCliSiteSelector(options = {}) {
  const site = getTrimmedOption(options.site);
  const host = getTrimmedOption(options.host);
  const url = getTrimmedOption(options.url);

  if ([site, host, url].filter(Boolean).length > 1) {
    throw new Error("Choose only one of --site, --host, or --url.");
  }

  if (site) {
    return { kind: "site", idOrKey: site };
  }

  if (url) {
    const parsed = new URL(url);
    return {
      kind: "host",
      host: parsed.host,
      pathPrefix: normalizePathPrefix(parsed.pathname),
    };
  }

  if (host) {
    return {
      kind: "host",
      host,
      pathPrefix: normalizePathPrefix(options.pathPrefix),
    };
  }

  return null;
}

// Mirrors `SiteService.getByIdOrKey`: an id match wins over a key match.
async function resolveSiteByIdOrKey(queryRunner, idOrKey) {
  const escaped = escapeSqlString(idOrKey);
  const rows = await queryRunner.query(`
    SELECT "id", "key", "status", "created_at", "updated_at"
    FROM "site"
    WHERE "id" = '${escaped}' OR "key" = '${escaped}'
    LIMIT 2
  `);

  const row =
    rows.find((candidate) => getOptionalString(candidate, "id") === idOrKey) ??
    rows[0];
  if (!row) {
    throw new Error(`No site found for --site ${idOrKey}.`);
  }

  return {
    created: false,
    site: toSite(row),
  };
}

async function resolveSiteByHost(queryRunner, host, pathPrefix) {
  const pathPrefixPredicate =
    pathPrefix === null
      ? `"site_domain"."path_prefix" IS NULL`
      : `"site_domain"."path_prefix" = '${escapeSqlString(pathPrefix)}'`;
  const rows = await queryRunner.query(`
    SELECT
      "site"."id",
      "site"."key",
      "site"."status",
      "site"."created_at",
      "site"."updated_at"
    FROM "site_domain"
    INNER JOIN "site" ON "site"."id" = "site_domain"."site_id"
    WHERE "site_domain"."host" = '${escapeSqlString(host)}'
      AND ${pathPrefixPredicate}
    ORDER BY "site"."created_at", "site"."id"
    LIMIT 2
  `);

  if (rows.length === 0) {
    throw new Error(
      `No site found for host "${host}"${pathPrefix ? ` and path prefix "${pathPrefix}"` : ""}.`,
    );
  }

  if (rows.length > 1) {
    throw new Error(
      `Multiple sites matched host "${host}"${pathPrefix ? ` and path prefix "${pathPrefix}"` : ""}.`,
    );
  }

  return {
    created: false,
    site: toSite(rows[0]),
  };
}

function toSite(row) {
  return {
    id: getRequiredString(row, "id"),
    key: getRequiredString(row, "key"),
    status: getRequiredString(row, "status"),
    createdAt: getRequiredNumber(row, "created_at"),
    updatedAt: getRequiredNumber(row, "updated_at"),
  };
}

function formatSiteSummary(rows) {
  return rows
    .map(
      (row) =>
        `${getRequiredString(row, "key")} (${getRequiredString(row, "id")})`,
    )
    .join(", ");
}

export function getCliSiteResolutionMode(env = process.env) {
  return env.SITE_RESOLUTION_MODE === "host-based"
    ? "host-based"
    : "single-site";
}

/**
 * Resolve the site a command acts on with raw SQL, for runtimes that cannot
 * run the site service (D1 through Wrangler, snapshot tooling).
 *
 * A site flag wins in either mode. Without one, single-site mode uses the
 * instance's one site, and host-based mode fails before querying: a hosted
 * database holds every tenant, so there is no default to fall back to.
 *
 * @param {{ query(sql: string): Promise<Record<string, unknown>[]>, execute?(sql: string): Promise<void> }} queryRunner
 *   Runs SQL against the target database
 * @param {{ env?: Record<string, string | undefined>, site?: string, host?: string, pathPrefix?: string, url?: string, createIfMissing?: boolean, bootstrapSite?: { id?: string, key?: string } }} [options]
 *   The environment, the command's site flags, and whether single-site mode
 *   may create the site shell when none exists
 * @returns {Promise<{ created: boolean, site: { id: string, key: string, status: string, createdAt: number, updatedAt: number } }>}
 *   The site, and whether this call created it
 * @throws {Error} When the flags match no site, when host-based mode has none,
 *   or when single-site mode finds zero sites it may not create or several
 * @example
 * const { site } = await resolveCliSite(context, {
 *   env: process.env,
 *   site: values.site,
 *   host: values.host,
 *   pathPrefix: values["path-prefix"],
 *   url: values.url,
 * });
 */
export async function resolveCliSite(queryRunner, options = {}) {
  const resolutionMode = getCliSiteResolutionMode(options.env);
  const selector = parseCliSiteSelector(options);

  if (selector?.kind === "site") {
    return resolveSiteByIdOrKey(queryRunner, selector.idOrKey);
  }

  if (selector?.kind === "host") {
    return resolveSiteByHost(queryRunner, selector.host, selector.pathPrefix);
  }

  if (resolutionMode === "host-based") {
    throw new Error(HOST_BASED_SITE_REQUIRED_MESSAGE);
  }

  const rows = await queryRunner.query(`
    SELECT "id", "key", "status", "created_at", "updated_at"
    FROM "site"
    ORDER BY "created_at", "id"
    LIMIT 2
  `);

  if (rows.length === 0) {
    if (!options.createIfMissing || typeof queryRunner.execute !== "function") {
      throw new Error(
        "single-site mode requires an initialized site. Complete /setup first or run a command that can bootstrap the site shell.",
      );
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const siteId = options.bootstrapSite?.id ?? typeidUnboxed("sit");
    const siteKey = options.bootstrapSite?.key ?? "default";

    await queryRunner.execute(`
      INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
      VALUES (
        '${escapeSqlString(siteId)}',
        '${escapeSqlString(siteKey)}',
        'active',
        ${timestamp},
        ${timestamp}
      );
    `);

    return {
      created: true,
      site: {
        id: siteId,
        key: siteKey,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };
  }

  if (rows.length > 1) {
    throw new Error(
      `single-site mode found multiple sites in the database: ${formatSiteSummary(rows)}. Restore SITE_RESOLUTION_MODE=host-based for this database, or remove the extra sites before restarting in single-site mode.`,
    );
  }

  return {
    created: false,
    site: toSite(rows[0]),
  };
}
