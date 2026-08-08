import {
  getHostedControlPlaneBaseUrl,
  getHostedControlPlaneProviderLabel as getConfiguredHostedControlPlaneProviderLabel,
  getSiteResolutionMode,
} from "./env.js";
import { isSafeInternalRedirect } from "./url.js";

function getHostedAdminContinuationPath(
  publicRequestUrl: string,
  redirect?: string,
): string {
  const currentHost = new URL(publicRequestUrl).host;
  const safeRedirect = isSafeInternalRedirect(redirect) ? redirect : "/";
  return `/auth/handoff/start?host=${encodeURIComponent(currentHost)}&redirect=${encodeURIComponent(safeRedirect)}`;
}

function buildHostedControlPlaneUrl(
  env: object | undefined | null,
  pathname: string,
  search?: string,
): string | null {
  const hostedControlPlaneBaseUrl = getHostedControlPlaneBaseUrl(env);
  if (
    !hostedControlPlaneBaseUrl ||
    getSiteResolutionMode(env) !== "host-based"
  ) {
    return null;
  }

  const location = new URL(hostedControlPlaneBaseUrl);
  location.pathname = pathname;
  location.search = search ?? "";
  return location.toString();
}

export function getHostedControlPlaneSigninUrl(
  env: object | undefined | null,
  publicRequestUrl: string,
  redirect?: string,
): string | null {
  return buildHostedControlPlaneUrl(
    env,
    "/auth/handoff/start",
    getHostedAdminContinuationPath(publicRequestUrl, redirect).replace(
      /^\/auth\/handoff\/start/,
      "",
    ),
  );
}

export function getHostedControlPlaneResetUrl(
  env: object | undefined | null,
  publicRequestUrl: string,
): string | null {
  const search = new URLSearchParams();
  search.set("next", getHostedAdminContinuationPath(publicRequestUrl));
  return buildHostedControlPlaneUrl(env, "/reset", `?${search.toString()}`);
}

export function getHostedControlPlaneDashboardUrl(
  env: object | undefined | null,
): string | null {
  return buildHostedControlPlaneUrl(env, "/app");
}

export function getHostedControlPlaneAccountUrl(
  env: object | undefined | null,
): string | null {
  return buildHostedControlPlaneUrl(env, "/settings/account");
}

export function getHostedControlPlaneAccountPasswordUrl(
  env: object | undefined | null,
): string | null {
  return buildHostedControlPlaneUrl(env, "/settings/account/password");
}

export function getHostedControlPlaneSiteSettingsUrl(
  env: object | undefined | null,
  coreSiteId: string,
): string | null {
  const normalizedCoreSiteId = coreSiteId.trim();
  if (!normalizedCoreSiteId) {
    return null;
  }

  return buildHostedControlPlaneUrl(
    env,
    `/sites/core/${encodeURIComponent(normalizedCoreSiteId)}/settings`,
  );
}

export function getHostedControlPlaneSiteDeleteUrl(
  env: object | undefined | null,
  coreSiteId: string,
): string | null {
  const normalizedCoreSiteId = coreSiteId.trim();
  if (!normalizedCoreSiteId) {
    return null;
  }

  return buildHostedControlPlaneUrl(
    env,
    `/sites/core/${encodeURIComponent(normalizedCoreSiteId)}/settings/delete`,
  );
}

export function getHostedControlPlaneProviderLabel(
  env: object | undefined | null,
): string | null {
  return getConfiguredHostedControlPlaneProviderLabel(env) ?? null;
}

export function isHostedControlPlaneEnabled(
  env: object | undefined | null,
): boolean {
  return (
    getSiteResolutionMode(env) === "host-based" &&
    Boolean(getHostedControlPlaneBaseUrl(env))
  );
}
