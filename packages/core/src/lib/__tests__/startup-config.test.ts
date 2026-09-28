import { describe, expect, it } from "vitest";
import {
  getRuntimeConfigurationErrorPage,
  getStartupConfigurationErrorPage,
} from "../startup-config.js";

const VALID_HOST_BASED_ENV = {
  AUTH_SECRET: "test-secret-with-enough-entropy-for-startup-checks",
  HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud-jant.localtest.me",
  HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET:
    "cloud-domain-check-secret-cloud-domain-check-secret",
  HOSTED_CONTROL_PLANE_INTERNAL_TOKEN: "internal-token-123456",
  HOSTED_CONTROL_PLANE_SSO_SECRET: "cloud-sso-secret-cloud-sso-secret",
  INTERNAL_ADMIN_TOKEN: "internal-admin-token-123456",
  SITE_RESOLUTION_MODE: "host-based" as const,
};

describe("getStartupConfigurationErrorPage", () => {
  it("does not block startup when AUTH_SECRET is present and long enough", () => {
    expect(
      getStartupConfigurationErrorPage({
        AUTH_SECRET: "test-secret-with-enough-entropy-for-startup-checks",
        DEV_API_TOKEN: "jnt_dev_test123",
      }),
    ).toBeNull();
  });

  it("returns an error page when AUTH_SECRET is missing", () => {
    const page = getStartupConfigurationErrorPage({
      DEV_API_TOKEN: "jnt_dev_test123",
    });

    expect(page).toContain("AUTH_SECRET is not set");
    expect(page).toContain(
      "Set <code>AUTH_SECRET=...</code> in the environment used to start Jant.",
    );
    expect(page).toContain("openssl rand -base64 32");
    expect(page).toContain("wrangler secret put AUTH_SECRET");
    expect(page).toContain("Open configuration instructions");
  });

  it("returns an error page when AUTH_SECRET is shorter than 32 characters", () => {
    const page = getStartupConfigurationErrorPage({
      AUTH_SECRET: "too-short",
      DEV_API_TOKEN: "jnt_dev_test123",
    });

    expect(page).toContain("AUTH_SECRET is too short");
    expect(page).toContain("at least 32 characters");
    expect(page).toContain("openssl rand -base64 32");
  });

  it("returns an error page when AUTH_SECRET still uses the .env.example placeholder", () => {
    const page = getStartupConfigurationErrorPage({
      AUTH_SECRET: "replace-me-replace-me-replace-me-replace-me-replace-me",
      DEV_API_TOKEN: "jnt_dev_test123",
    });

    expect(page).toContain(
      "AUTH_SECRET is still the placeholder from .env.example",
    );
    expect(page).toContain("publicly known");
    expect(page).toContain("openssl rand -base64 32");
  });

  it("does not block startup when host-based required variables are present", () => {
    expect(getStartupConfigurationErrorPage(VALID_HOST_BASED_ENV)).toBeNull();
  });

  it("returns an error page when host-based required variables are missing", () => {
    const page = getStartupConfigurationErrorPage({
      AUTH_SECRET: "test-secret-with-enough-entropy-for-startup-checks",
      SITE_RESOLUTION_MODE: "host-based",
    });

    expect(page).toContain("Hosted configuration is incomplete");
    expect(page).toContain("HOSTED_CONTROL_PLANE_BASE_URL");
    expect(page).toContain("HOSTED_CONTROL_PLANE_INTERNAL_TOKEN");
    expect(page).toContain("INTERNAL_ADMIN_TOKEN");
    expect(page).toContain("HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET");
    expect(page).toContain("HOSTED_CONTROL_PLANE_SSO_SECRET");
  });

  it("returns an error page when host-based shared secrets are too short", () => {
    const page = getStartupConfigurationErrorPage({
      ...VALID_HOST_BASED_ENV,
      HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET: "too-short",
      HOSTED_CONTROL_PLANE_SSO_SECRET: "also-too-short",
    });

    expect(page).toContain(
      "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET must be at least 32 characters in host-based mode.",
    );
    expect(page).toContain(
      "HOSTED_CONTROL_PLANE_SSO_SECRET must be at least 32 characters in host-based mode.",
    );
  });

  it("returns an error page naming each environment value Jant can't use", () => {
    const page = getStartupConfigurationErrorPage({
      AUTH_SECRET: "test-secret-with-enough-entropy-for-startup-checks",
      PAGE_SIZE: "500",
      STORAGE_DRIVER: "S3",
    } as Parameters<typeof getStartupConfigurationErrorPage>[0]);

    expect(page).toContain("Environment values need fixing");
    expect(page).toContain("PAGE_SIZE can&#39;t be &quot;500&quot;");
    expect(page).toContain("STORAGE_DRIVER can&#39;t be &quot;S3&quot;");
  });

  it("renders runtime configuration failures as a user-facing error page", () => {
    const page = getRuntimeConfigurationErrorPage(
      "single-site mode found multiple sites in the database.",
    );

    expect(page).toContain("Configuration Error");
    expect(page).toContain(
      "single-site mode found multiple sites in the database.",
    );
    expect(page).toContain(
      "Update your environment or instance data, then restart Jant.",
    );
  });
});
