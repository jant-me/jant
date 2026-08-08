import { describe, expect, it } from "vitest";
import {
  getHostedControlPlaneAccountPasswordUrl,
  getHostedControlPlaneAccountUrl,
  getHostedControlPlaneDashboardUrl,
  getHostedControlPlaneProviderLabel,
  getHostedControlPlaneResetUrl,
  getHostedControlPlaneSigninUrl,
  getHostedControlPlaneSiteDeleteUrl,
  getHostedControlPlaneSiteSettingsUrl,
  isHostedControlPlaneEnabled,
} from "../hosted-signin.js";

describe("getHostedControlPlaneSigninUrl", () => {
  it("returns the hosted auth handoff URL for hosted sites", () => {
    const url = getHostedControlPlaneSigninUrl(
      {
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud-jant.localtest.me",
        SITE_RESOLUTION_MODE: "host-based",
      },
      "https://site7.localtest.me/signin",
    );

    expect(url).toBe(
      "https://cloud-jant.localtest.me/auth/handoff/start?host=site7.localtest.me&redirect=%2F",
    );
  });

  it("forwards a safe post-signin redirect through the handoff URL", () => {
    const url = getHostedControlPlaneSigninUrl(
      {
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud-jant.localtest.me",
        SITE_RESOLUTION_MODE: "host-based",
      },
      "https://site7.localtest.me/signin",
      "/settings/general",
    );

    expect(url).toBe(
      "https://cloud-jant.localtest.me/auth/handoff/start?host=site7.localtest.me&redirect=%2Fsettings%2Fgeneral",
    );
  });

  it("falls back to / when the supplied redirect is unsafe", () => {
    const url = getHostedControlPlaneSigninUrl(
      {
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud-jant.localtest.me",
        SITE_RESOLUTION_MODE: "host-based",
      },
      "https://site7.localtest.me/signin",
      "//evil.example/steal",
    );

    expect(url).toBe(
      "https://cloud-jant.localtest.me/auth/handoff/start?host=site7.localtest.me&redirect=%2F",
    );
  });

  it("returns null outside host-based mode", () => {
    const url = getHostedControlPlaneSigninUrl(
      {
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud-jant.localtest.me",
        SITE_RESOLUTION_MODE: "single-site",
      },
      "https://site7.localtest.me/signin",
    );

    expect(url).toBeNull();
  });

  it("returns the hosted auth reset URL for hosted sites", () => {
    const url = getHostedControlPlaneResetUrl(
      {
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud-jant.localtest.me",
        SITE_RESOLUTION_MODE: "host-based",
      },
      "https://site7.localtest.me/reset",
    );

    expect(url).toBe(
      "https://cloud-jant.localtest.me/reset?next=%2Fauth%2Fhandoff%2Fstart%3Fhost%3Dsite7.localtest.me%26redirect%3D%252F",
    );
  });

  it("returns hosted dashboard and account URLs", () => {
    const env = {
      HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud-jant.localtest.me",
      SITE_RESOLUTION_MODE: "host-based",
    };

    expect(getHostedControlPlaneDashboardUrl(env)).toBe(
      "https://cloud-jant.localtest.me/app",
    );
    expect(getHostedControlPlaneAccountUrl(env)).toBe(
      "https://cloud-jant.localtest.me/settings/account",
    );
    expect(getHostedControlPlaneAccountPasswordUrl(env)).toBe(
      "https://cloud-jant.localtest.me/settings/account/password",
    );
    expect(getHostedControlPlaneSiteSettingsUrl(env, "sit_demo")).toBe(
      "https://cloud-jant.localtest.me/sites/core/sit_demo/settings",
    );
    expect(getHostedControlPlaneSiteDeleteUrl(env, "sit_demo")).toBe(
      "https://cloud-jant.localtest.me/sites/core/sit_demo/settings/delete",
    );
    expect(isHostedControlPlaneEnabled(env)).toBe(true);
  });

  it("uses the configured provider name when available", () => {
    expect(
      getHostedControlPlaneProviderLabel({
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud-jant.localtest.me",
        HOSTED_CONTROL_PLANE_PROVIDER_NAME: "Managed sign-in",
      }),
    ).toBe("Managed sign-in");
  });

  it("falls back to the provider host when no provider name is configured", () => {
    expect(
      getHostedControlPlaneProviderLabel({
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud-jant.localtest.me",
      }),
    ).toBe("cloud-jant.localtest.me");
  });

  it("falls back to the provider host when the provider name is visually blank", () => {
    expect(
      getHostedControlPlaneProviderLabel({
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud-jant.localtest.me",
        HOSTED_CONTROL_PLANE_PROVIDER_NAME: "\u200B\u2060",
      }),
    ).toBe("cloud-jant.localtest.me");
  });

  it("disables hosted auth without a hosted auth base URL", () => {
    expect(
      isHostedControlPlaneEnabled({
        SITE_RESOLUTION_MODE: "host-based",
      }),
    ).toBe(false);
  });
});
