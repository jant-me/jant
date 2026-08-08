/**
 * Standalone page served when a site resolves but is suspended.
 *
 * Kept deliberately self-contained (no theme, no site services, no i18n
 * catalog): it renders before any site context exists, and the site whose
 * theme we would otherwise use is exactly the one that is unavailable.
 *
 * The copy stays provider-neutral. Hosted deployments pass their brand across
 * the boundary through `HOSTED_CONTROL_PLANE_PROVIDER_NAME` /
 * `HOSTED_CONTROL_PLANE_BASE_URL`, which turn the last line into a real link
 * back to the control plane; a self-hosted instance renders the same page
 * without one.
 */

import { getHostedControlPlaneProviderLabel } from "./env.js";
import { getHostedControlPlaneDashboardUrl } from "./hosted-signin.js";
import { escapeHtml } from "./html.js";

export function renderSiteUnavailablePage(
  env: object | undefined | null,
): string {
  const providerLabel = getHostedControlPlaneProviderLabel(env);
  const dashboardUrl = getHostedControlPlaneDashboardUrl(env);

  const ownerLine =
    dashboardUrl && providerLabel
      ? `<p>If it's your site, sign in to <a href="${escapeHtml(dashboardUrl)}">${escapeHtml(providerLabel)}</a> to bring it back online.</p>`
      : `<p>If it's your site, sign in to your hosting provider to bring it back online.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>This site is offline</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#fafafa;color:#111;padding:24px}div{max-width:460px;text-align:left}h1{font-size:1.25rem;font-weight:600;margin:0 0 12px}p{color:#4a4a4a;line-height:1.6;margin:12px 0}a{color:#0f766e}@media(prefers-color-scheme:dark){body{background:#111;color:#fafafa}p{color:#a1a1a1}a{color:#2dd4bf}}</style>
</head>
<body>
<div>
<h1>This site is offline</h1>
<p>There's nothing to read here right now &mdash; the site's hosting has stopped.</p>
${ownerLine}
</div>
</body>
</html>`;
}
