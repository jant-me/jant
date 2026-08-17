/**
 * Security Headers Middleware
 *
 * Adds a small set of explicit security headers. Public pages are allowed to
 * be embedded in iframes and to load third-party scripts/iframes (so YouTube,
 * Letterbird, analytics widgets, etc. work out of the box). Authoring, auth,
 * and API routes keep clickjacking protection and a tight CSP.
 *
 * The CSP itself is built by `lib/csp-builder.ts` so it's unit-testable.
 */

import { secureHeaders } from "hono/secure-headers";
import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { getConfiguredStorageDriver, getEnvString } from "../lib/env.js";
import { IS_VITE_DEV } from "../lib/build-env.js";
import {
  buildCspDirectives,
  type ContentSecurityPolicyDirectives,
} from "../lib/csp-builder.js";

type Env = { Bindings: Bindings; Variables: AppVariables };
type SecureHeadersOptions = NonNullable<Parameters<typeof secureHeaders>[0]>;
type ContentSecurityPolicyOptions = NonNullable<
  SecureHeadersOptions["contentSecurityPolicy"]
>;

const FRAME_PROTECTED_PATH_PREFIXES = [
  "/api",
  "/settings",
  "/compose",
  "/signin",
  "/signout",
  "/reset",
  "/setup",
  "/__dev",
] as const;

function matchesPathPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function shouldBlockFraming(path: string): boolean {
  return FRAME_PROTECTED_PATH_PREFIXES.some((prefix) =>
    matchesPathPrefix(path, prefix),
  );
}

/**
 * Paths whose responses are not HTML rendered by `BaseLayout` and therefore
 * never carry author-pasted `customHeadHtml` / `customBodyEndHtml`. Skipping
 * the settings lookup for these avoids two DB roundtrips on every static
 * asset request.
 */
function couldRenderCodeInjection(path: string): boolean {
  if (shouldBlockFraming(path)) return false;
  if (path === "/favicon.ico" || path === "/apple-touch-icon.png") return false;
  if (path === "/healthz" || path === "/readyz") return false;
  if (path.startsWith("/media/") || path.startsWith("/sites/")) return false;
  return true;
}

function tryGetOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getDirectUploadConnectSources(env: Bindings): string[] {
  if (getConfiguredStorageDriver(env) !== "s3") return [];

  const sources: string[] = [];
  const endpoint = getEnvString(env, "S3_ENDPOINT");
  const bucket = getEnvString(env, "S3_BUCKET");
  const endpointOrigin = tryGetOrigin(endpoint);
  if (endpointOrigin) sources.push(endpointOrigin);

  if (!endpoint || !bucket) return sources;

  try {
    const parsed = new URL(endpoint);
    const hostname = parsed.hostname;
    if (
      hostname.includes("amazonaws.com") &&
      !hostname.startsWith(`${bucket}.`)
    ) {
      sources.push(`${parsed.protocol}//${bucket}.${parsed.host}`);
    }
  } catch {
    // Ignore invalid endpoints.
  }

  return sources;
}

function toHonoCspOptions(
  directives: ContentSecurityPolicyDirectives,
): ContentSecurityPolicyOptions {
  // Hono's `secureHeaders` accepts the same shape we produce, but with optional
  // arrays. Passing the typed directives directly keeps the contract honest.
  const result: ContentSecurityPolicyOptions = {
    defaultSrc: directives.defaultSrc,
    scriptSrc: directives.scriptSrc,
    styleSrc: directives.styleSrc,
    imgSrc: directives.imgSrc,
    mediaSrc: directives.mediaSrc,
    fontSrc: directives.fontSrc,
    connectSrc: directives.connectSrc,
    objectSrc: directives.objectSrc,
    baseUri: directives.baseUri,
    formAction: directives.formAction,
  };
  if (directives.frameSrc) result.frameSrc = directives.frameSrc;
  if (directives.frameAncestors)
    result.frameAncestors = directives.frameAncestors;
  return result;
}

function buildSecureHeadersOptions(
  path: string,
  env: Bindings,
  allowInlineScript: boolean,
): SecureHeadersOptions {
  const directives = buildCspDirectives({
    path,
    isFrameProtected: shouldBlockFraming(path),
    assetOrigin: tryGetOrigin(getEnvString(env, "ASSET_BASE_URL")),
    uploadConnectSources: getDirectUploadConnectSources(env),
    isDev: IS_VITE_DEV,
    allowInlineScript,
  });

  return {
    contentSecurityPolicy: toHonoCspOptions(directives),
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    referrerPolicy: "strict-origin-when-cross-origin",
    strictTransportSecurity: true,
    xContentTypeOptions: true,
    xDnsPrefetchControl: false,
    xDownloadOptions: false,
    xFrameOptions: shouldBlockFraming(path) ? "DENY" : false,
    xPermittedCrossDomainPolicies: false,
    xXssProtection: false,
  };
}

/**
 * Probe the settings service for any author-saved code injection. Resolves to
 * `false` whenever the lookup is unavailable (e.g. in unit tests that skip the
 * runtime middleware) or the path can't render `BaseLayout`.
 *
 * Costs two settings reads on public HTML routes; static asset and
 * frame-protected paths are short-circuited above.
 */
async function detectInlineScriptOptIn(
  path: string,
  settings: { get(key: string): Promise<string | null> } | undefined,
): Promise<boolean> {
  if (!settings) return false;
  if (!couldRenderCodeInjection(path)) return false;
  const [head, bodyEnd] = await Promise.all([
    settings.get("CUSTOM_HEAD_HTML"),
    settings.get("CUSTOM_BODY_END_HTML"),
  ]);
  return Boolean(head?.trim() || bodyEnd?.trim());
}

export function secureHeadersMiddleware(): MiddlewareHandler<Env> {
  return async (c, next) => {
    // `services` is set by the runtime bootstrap middleware. Cast through
    // `undefined` so unit tests that skip that middleware still work.
    const services = c.var.services as AppVariables["services"] | undefined;
    const allowInlineScript = await detectInlineScriptOptIn(
      c.req.path,
      services?.settings,
    );
    return secureHeaders(
      buildSecureHeadersOptions(c.req.path, c.env, allowInlineScript),
    )(c, next);
  };
}
