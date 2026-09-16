import { createDatabase, createNodeDatabase } from "../db/index.js";
import { sqliteSchemaBundle } from "../db/schema-bundle.js";
import {
  getAuthSecretIssueKind,
  getAuthSecretReadinessError,
  getHostBasedStartupConfigurationIssues,
} from "../lib/startup-config.js";
import { CORE_VERSION } from "../lib/version.js";
import { createSiteService } from "../services/site.js";
import type { Bindings } from "../types/bindings.js";

export interface ReadinessCheckStatus {
  ok: boolean;
  error?: string;
}

export interface InstanceReadinessResult {
  status: "ok" | "error";
  /** The running build: the package version, then the build's commit id. */
  version: string;
  /**
   * When the Node process started serving, in Unix seconds. With `version`,
   * it lets a deploy check from outside that the instance answering is one
   * started after the deploy, not an older one a rollback left running.
   * Absent on Workers.
   */
  startedAt?: number;
  checks: {
    startupConfig: ReadinessCheckStatus;
    database: ReadinessCheckStatus;
  };
}

function getStartupConfigurationReadiness(
  env: Pick<
    Bindings,
    | "AUTH_SECRET"
    | "HOSTED_CONTROL_PLANE_BASE_URL"
    | "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET"
    | "HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL"
    | "HOSTED_CONTROL_PLANE_INTERNAL_TOKEN"
    | "HOSTED_CONTROL_PLANE_SSO_SECRET"
    | "INTERNAL_ADMIN_TOKEN"
    | "SITE_RESOLUTION_MODE"
  >,
): ReadinessCheckStatus {
  const errors: string[] = [];

  const authSecretIssue = getAuthSecretIssueKind(env);
  if (authSecretIssue) {
    errors.push(getAuthSecretReadinessError(authSecretIssue));
  }

  for (const issue of getHostBasedStartupConfigurationIssues(env)) {
    errors.push(`${issue.variable}: ${issue.message}`);
  }

  return errors.length > 0
    ? {
        ok: false,
        error: errors.join(" "),
      }
    : { ok: true };
}

async function getDatabaseReadiness(
  env: Pick<Bindings, "DB" | "NODE_DATABASE" | "NODE_SQLITE">,
): Promise<ReadinessCheckStatus> {
  try {
    if (env.NODE_DATABASE?.db) {
      const siteService = createSiteService(
        env.NODE_DATABASE.db,
        env.NODE_DATABASE.schema,
      );
      await siteService.getById("sit_readiness_probe");
      return { ok: true };
    }

    if (env.NODE_SQLITE) {
      const siteService = createSiteService(
        createNodeDatabase(env.NODE_SQLITE),
      );
      await siteService.getById("sit_readiness_probe");
      return { ok: true };
    }

    if (env.DB) {
      // Use a D1 session to mirror the normal Cloudflare runtime path.
      const session = env.DB.withSession();
      const siteService = createSiteService(
        createDatabase(session as unknown as D1Database),
        sqliteSchemaBundle,
      );
      await siteService.getById("sit_readiness_probe");
      return { ok: true };
    }

    return {
      ok: false,
      error: "No database binding is configured for this runtime.",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Perform instance-scoped readiness checks that bypass site resolution.
 *
 * This is intentionally stricter than `/healthz`: it verifies startup
 * configuration and performs a lightweight database/schema query against the
 * shared `site` table through the service layer.
 */
export async function getInstanceReadiness(
  env: Pick<
    Bindings,
    | "AUTH_SECRET"
    | "DB"
    | "HOSTED_CONTROL_PLANE_BASE_URL"
    | "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET"
    | "HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL"
    | "HOSTED_CONTROL_PLANE_INTERNAL_TOKEN"
    | "HOSTED_CONTROL_PLANE_SSO_SECRET"
    | "INTERNAL_ADMIN_TOKEN"
    | "NODE_DATABASE"
    | "NODE_SQLITE"
    | "NODE_STARTED_AT"
    | "SITE_RESOLUTION_MODE"
  >,
): Promise<InstanceReadinessResult> {
  const startupConfig = getStartupConfigurationReadiness(env);
  const database = await getDatabaseReadiness(env);

  return {
    status: startupConfig.ok && database.ok ? "ok" : "error",
    version: CORE_VERSION,
    ...(env.NODE_STARTED_AT === undefined
      ? {}
      : { startedAt: env.NODE_STARTED_AT }),
    checks: {
      startupConfig,
      database,
    },
  };
}
