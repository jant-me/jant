import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../../__tests__/helpers/db.js";
import { getInstanceReadiness } from "../readiness.js";

const HOSTED_SHARED_ENV = {
  HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud-jant.localtest.me",
  HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET:
    "cloud-domain-check-secret-cloud-domain-check-secret",
  HOSTED_CONTROL_PLANE_INTERNAL_TOKEN: "internal-token-123456",
  HOSTED_CONTROL_PLANE_SSO_SECRET: "cloud-sso-secret-cloud-sso-secret",
  INTERNAL_ADMIN_TOKEN: "internal-admin-token-123456",
  SITE_RESOLUTION_MODE: "host-based" as const,
};

describe("getInstanceReadiness", () => {
  it("reports ready when startup config and database checks pass", async () => {
    const { sqlite } = createTestDatabase();

    await expect(
      getInstanceReadiness({
        ...HOSTED_SHARED_ENV,
        AUTH_SECRET: "test-secret-with-enough-entropy-for-readiness",
        NODE_SQLITE: sqlite,
      }),
    ).resolves.toEqual({
      status: "ok",
      version: "test-version",
      checks: {
        startupConfig: { ok: true },
        database: { ok: true },
      },
    });
  });

  it("reports startup configuration failures", async () => {
    const { sqlite } = createTestDatabase();

    await expect(
      getInstanceReadiness({
        NODE_SQLITE: sqlite,
      }),
    ).resolves.toEqual({
      status: "error",
      version: "test-version",
      checks: {
        startupConfig: {
          ok: false,
          error: "AUTH_SECRET must be set before Jant can accept traffic.",
        },
        database: { ok: true },
      },
    });
  });

  it("reports startup configuration failures when AUTH_SECRET is too short", async () => {
    const { sqlite } = createTestDatabase();

    const result = await getInstanceReadiness({
      AUTH_SECRET: "too-short",
      NODE_SQLITE: sqlite,
    });

    expect(result.status).toBe("error");
    expect(result.checks.database).toEqual({ ok: true });
    expect(result.checks.startupConfig.ok).toBe(false);
    expect(result.checks.startupConfig.error).toContain(
      "AUTH_SECRET must be at least 32 characters",
    );
    expect(result.checks.startupConfig.error).toContain(
      "openssl rand -base64 32",
    );
  });

  it("reports startup configuration failures when AUTH_SECRET is still the placeholder", async () => {
    const { sqlite } = createTestDatabase();

    const result = await getInstanceReadiness({
      AUTH_SECRET: "replace-me-replace-me-replace-me-replace-me-replace-me",
      NODE_SQLITE: sqlite,
    });

    expect(result.status).toBe("error");
    expect(result.checks.startupConfig.ok).toBe(false);
    expect(result.checks.startupConfig.error).toContain(
      "AUTH_SECRET still uses the placeholder value from .env.example",
    );
  });

  it("reports host-based startup issues when required env is missing", async () => {
    const { sqlite } = createTestDatabase();

    const result = await getInstanceReadiness({
      AUTH_SECRET: "test-secret-with-enough-entropy-for-readiness",
      NODE_SQLITE: sqlite,
      SITE_RESOLUTION_MODE: "host-based",
    });

    expect(result.status).toBe("error");
    expect(result.checks.database).toEqual({ ok: true });
    expect(result.checks.startupConfig.ok).toBe(false);
    expect(result.checks.startupConfig.error).toContain(
      "HOSTED_CONTROL_PLANE_BASE_URL",
    );
    expect(result.checks.startupConfig.error).toContain(
      "HOSTED_CONTROL_PLANE_INTERNAL_TOKEN",
    );
  });

  // What a deploy check compares: the build that answers, and when its
  // process started. A Worker has no process, so it reports only the build.
  it("reports the build, and the process start where there is one", async () => {
    const { sqlite } = createTestDatabase();
    const env = {
      AUTH_SECRET: "test-secret-with-enough-entropy-for-readiness",
      NODE_SQLITE: sqlite,
    };

    const withoutStart = await getInstanceReadiness(env);
    expect(withoutStart.version).toBe("test-version");
    expect(withoutStart).not.toHaveProperty("startedAt");

    const withStart = await getInstanceReadiness({
      ...env,
      NODE_STARTED_AT: 1789000000,
    });
    expect(withStart.startedAt).toBe(1789000000);
  });

  it("reports a missing database binding", async () => {
    await expect(
      getInstanceReadiness({
        AUTH_SECRET: "test-secret-with-enough-entropy-for-readiness",
      }),
    ).resolves.toEqual({
      status: "error",
      version: "test-version",
      checks: {
        startupConfig: { ok: true },
        database: {
          ok: false,
          error: "No database binding is configured for this runtime.",
        },
      },
    });
  });
});
