import { escapeHtml } from "./html.js";
import { getJantDocsUrl } from "./jant-docs.js";
import {
  getAuthSecret,
  getHostedControlPlaneBaseUrl,
  getHostedControlPlaneDomainCheckSecret,
  getHostedControlPlaneInternalBaseUrl,
  getHostedControlPlaneInternalToken,
  getHostedControlPlaneSsoSecret,
  getInternalAdminToken,
  getSiteResolutionMode,
} from "./env.js";
import type { Bindings } from "../types.js";

const HOSTED_SHARED_SECRET_MIN_LENGTH = 32;
export const AUTH_SECRET_MIN_LENGTH = 32;

const AUTH_SECRET_GENERATION_HINT =
  "Generate one with `openssl rand -base64 32`.";

const AUTH_SECRET_PLACEHOLDER_MARKER = "replace-me";

type AuthSecretIssueKind = "missing" | "placeholder" | "too-short";

export function getAuthSecretIssueKind(
  env: Pick<Bindings, "AUTH_SECRET">,
): AuthSecretIssueKind | null {
  const secret = getAuthSecret(env);
  if (!secret) {
    return "missing";
  }
  if (secret.toLowerCase().includes(AUTH_SECRET_PLACEHOLDER_MARKER)) {
    return "placeholder";
  }
  if (secret.length < AUTH_SECRET_MIN_LENGTH) {
    return "too-short";
  }
  return null;
}

export function getAuthSecretReadinessError(kind: AuthSecretIssueKind): string {
  if (kind === "placeholder") {
    return `AUTH_SECRET still uses the placeholder value from .env.example. ${AUTH_SECRET_GENERATION_HINT}`;
  }
  if (kind === "too-short") {
    return `AUTH_SECRET must be at least ${AUTH_SECRET_MIN_LENGTH} characters before Jant can accept traffic. ${AUTH_SECRET_GENERATION_HINT}`;
  }
  return "AUTH_SECRET must be set before Jant can accept traffic.";
}

interface StartupConfigurationIssue {
  message: string;
  variable: string;
}

function renderConfigurationErrorPage(input: {
  title: string;
  bodyHtml: string;
  docsHref: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Configuration Error</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#fafafa;color:#111;padding:24px}div{max-width:560px;text-align:left;background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.04)}h1{font-size:1.25rem;font-weight:600;margin:0 0 12px}p{color:#4a4a4a;line-height:1.6;margin:12px 0}code{background:#f1f1f1;padding:2px 6px;border-radius:4px;font-size:.9em}a{color:#0f766e;text-decoration:none}a:hover{text-decoration:underline}</style>
</head>
<body>
<div>
<h1>${input.title}</h1>
${input.bodyHtml}
<p><a href="${input.docsHref}" target="_blank" rel="noopener noreferrer">Open configuration instructions</a></p>
</div>
</body>
</html>`;
}

function getAuthSecretErrorHtml(kind: AuthSecretIssueKind): string {
  const runtimeInstructions = `<p>Set <code>AUTH_SECRET=...</code> in the environment used to start Jant. Generate one with <code>openssl rand -base64 32</code>.</p>
<p><strong>Cloudflare Workers:</strong> add <code>AUTH_SECRET</code> as a Worker secret in the dashboard under Variables and Secrets, or run <code>wrangler secret put AUTH_SECRET</code>.</p>`;

  const titleByKind: Record<AuthSecretIssueKind, string> = {
    missing: "AUTH_SECRET is not set",
    placeholder: "AUTH_SECRET is still the placeholder from .env.example",
    "too-short": `AUTH_SECRET is too short (must be at least ${AUTH_SECRET_MIN_LENGTH} characters)`,
  };

  const leadByKind: Record<AuthSecretIssueKind, string> = {
    missing: `<p>Jant needs a ${AUTH_SECRET_MIN_LENGTH}+ character auth secret to sign sessions.</p>`,
    placeholder: `<p>The current <code>AUTH_SECRET</code> still contains the <code>replace-me</code> placeholder from <code>.env.example</code>. This value is publicly known and unsafe to use; replace it with a real secret before serving traffic.</p>`,
    "too-short": `<p>Jant needs an auth secret of at least ${AUTH_SECRET_MIN_LENGTH} characters to sign sessions. The current value is too short.</p>`,
  };

  return renderConfigurationErrorPage({
    title: titleByKind[kind],
    bodyHtml: `${leadByKind[kind]}${runtimeInstructions}`,
    docsHref: getJantDocsUrl("configuration#required"),
  });
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function collectHostBasedStartupConfigurationIssues(
  env: Pick<
    Bindings,
    | "HOSTED_CONTROL_PLANE_BASE_URL"
    | "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET"
    | "HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL"
    | "HOSTED_CONTROL_PLANE_INTERNAL_TOKEN"
    | "HOSTED_CONTROL_PLANE_SSO_SECRET"
    | "INTERNAL_ADMIN_TOKEN"
    | "SITE_RESOLUTION_MODE"
  >,
): StartupConfigurationIssue[] {
  if (getSiteResolutionMode(env) !== "host-based") {
    return [];
  }

  const issues: StartupConfigurationIssue[] = [];
  const hostedControlPlaneBaseUrl = getHostedControlPlaneBaseUrl(env);
  const hostedControlPlaneInternalBaseUrl =
    getHostedControlPlaneInternalBaseUrl(env);
  const hostedControlPlaneInternalToken =
    getHostedControlPlaneInternalToken(env);
  const internalAdminToken = getInternalAdminToken(env);
  const domainCheckSecret = getHostedControlPlaneDomainCheckSecret(env);
  const hostedSsoSecret = getHostedControlPlaneSsoSecret(env);

  if (!hostedControlPlaneBaseUrl) {
    issues.push({
      message:
        "HOSTED_CONTROL_PLANE_BASE_URL must be set when SITE_RESOLUTION_MODE=host-based.",
      variable: "HOSTED_CONTROL_PLANE_BASE_URL",
    });
  } else if (!isValidHttpUrl(hostedControlPlaneBaseUrl)) {
    issues.push({
      message:
        "HOSTED_CONTROL_PLANE_BASE_URL must be a valid http:// or https:// URL.",
      variable: "HOSTED_CONTROL_PLANE_BASE_URL",
    });
  }

  if (
    hostedControlPlaneInternalBaseUrl &&
    !isValidHttpUrl(hostedControlPlaneInternalBaseUrl)
  ) {
    issues.push({
      message:
        "HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL must be a valid http:// or https:// URL when set.",
      variable: "HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL",
    });
  }

  if (!hostedControlPlaneInternalToken) {
    issues.push({
      message:
        "HOSTED_CONTROL_PLANE_INTERNAL_TOKEN must be set when SITE_RESOLUTION_MODE=host-based.",
      variable: "HOSTED_CONTROL_PLANE_INTERNAL_TOKEN",
    });
  }

  if (!internalAdminToken) {
    issues.push({
      message:
        "INTERNAL_ADMIN_TOKEN must be set when SITE_RESOLUTION_MODE=host-based.",
      variable: "INTERNAL_ADMIN_TOKEN",
    });
  }

  if (!domainCheckSecret) {
    issues.push({
      message:
        "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET must be set when SITE_RESOLUTION_MODE=host-based.",
      variable: "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET",
    });
  } else if (domainCheckSecret.length < HOSTED_SHARED_SECRET_MIN_LENGTH) {
    issues.push({
      message:
        "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET must be at least 32 characters in host-based mode.",
      variable: "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET",
    });
  }

  if (!hostedSsoSecret) {
    issues.push({
      message:
        "HOSTED_CONTROL_PLANE_SSO_SECRET must be set when SITE_RESOLUTION_MODE=host-based.",
      variable: "HOSTED_CONTROL_PLANE_SSO_SECRET",
    });
  } else if (hostedSsoSecret.length < HOSTED_SHARED_SECRET_MIN_LENGTH) {
    issues.push({
      message:
        "HOSTED_CONTROL_PLANE_SSO_SECRET must be at least 32 characters in host-based mode.",
      variable: "HOSTED_CONTROL_PLANE_SSO_SECRET",
    });
  }

  return issues;
}

function getHostBasedConfigurationErrorHtml(
  issues: readonly StartupConfigurationIssue[],
): string {
  const itemsHtml = issues
    .map(
      (issue) =>
        `<li><code>${escapeHtml(issue.variable)}</code>: ${escapeHtml(issue.message)}</li>`,
    )
    .join("");

  return renderConfigurationErrorPage({
    title: "Hosted configuration is incomplete",
    bodyHtml: `<p>Jant is running with <code>SITE_RESOLUTION_MODE=host-based</code>, so hosted control-plane integration must be configured before the instance can serve requests.</p><ul>${itemsHtml}</ul>`,
    docsHref: getJantDocsUrl("configuration"),
  });
}

export function getHostBasedStartupConfigurationIssues(
  env: Pick<
    Bindings,
    | "HOSTED_CONTROL_PLANE_BASE_URL"
    | "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET"
    | "HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL"
    | "HOSTED_CONTROL_PLANE_INTERNAL_TOKEN"
    | "HOSTED_CONTROL_PLANE_SSO_SECRET"
    | "INTERNAL_ADMIN_TOKEN"
    | "SITE_RESOLUTION_MODE"
  >,
): StartupConfigurationIssue[] {
  return collectHostBasedStartupConfigurationIssues(env);
}

export function getRuntimeConfigurationErrorPage(message: string): string {
  return renderConfigurationErrorPage({
    title: "Configuration Error",
    bodyHtml: `<p>${escapeHtml(message)}</p><p>Update your environment or instance data, then restart Jant.</p>`,
    docsHref: getJantDocsUrl("configuration"),
  });
}

/**
 * Returns the startup configuration error page for invalid required env vars.
 *
 * @param env - Worker bindings available at startup
 * @returns HTML for a blocking startup configuration error, or `null` when config is valid
 *
 * @example
 * ```ts
 * getStartupConfigurationErrorPage({ AUTH_SECRET: "secret" }) // null
 * ```
 */
export function getStartupConfigurationErrorPage(
  env: Pick<
    Bindings,
    | "AUTH_SECRET"
    | "DEV_API_TOKEN"
    | "NODE_DATABASE"
    | "NODE_SQLITE"
    | "DATABASE_URL"
    | "DATA_DIR"
    | "HOSTED_CONTROL_PLANE_BASE_URL"
    | "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET"
    | "HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL"
    | "HOSTED_CONTROL_PLANE_INTERNAL_TOKEN"
    | "HOSTED_CONTROL_PLANE_SSO_SECRET"
    | "INTERNAL_ADMIN_TOKEN"
    | "SITE_RESOLUTION_MODE"
  >,
): string | null {
  const authSecretIssue = getAuthSecretIssueKind(env);
  if (authSecretIssue) {
    return getAuthSecretErrorHtml(authSecretIssue);
  }

  const hostBasedIssues = collectHostBasedStartupConfigurationIssues(env);
  if (hostBasedIssues.length > 0) {
    return getHostBasedConfigurationErrorHtml(hostBasedIssues);
  }

  return null;
}
