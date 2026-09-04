/**
 * Content Security Policy Builder
 *
 * Pure function that takes the request path and Jant's runtime context, and
 * returns the CSP directives. Extracted from the middleware so it can be
 * unit-tested without mocking Hono.
 *
 * Design rationale (Jant-specific):
 *
 *   - **Public pages** allow `frame-src`, `script-src`, `style-src`,
 *     `font-src`, and `connect-src` to load from any `https:` source. The site
 *     author is the only content source — there is no UGC, no untrusted
 *     writer, no public composer. Locking these down would block legitimate
 *     embeds (YouTube, Letterbird, analytics), giscus's stylesheet, and
 *     Google Fonts, and deliver no security benefit Jant doesn't already get
 *     from being single-author. This matches Ghost/WordPress/Bear precedent.
 *
 *   - **Authoring/auth/API routes** (FRAME_PROTECTED_PATH_PREFIXES) keep the
 *     tight policy: only same-origin scripts, no third-party iframes, and
 *     `frame-ancestors 'none'`. Compromise of an embed page must not lead
 *     into the settings pages.
 */

export interface CspBuildInput {
  path: string;
  isFrameProtected: boolean;
  /** Origin extracted from `ASSET_BASE_URL`, or null. */
  assetOrigin: string | null;
  /** Direct-upload connect-src origins (S3 endpoint, virtual-hosted bucket). */
  uploadConnectSources: string[];
  /** True in `vite dev` so we add `ws:` to connect-src. */
  isDev: boolean;
  /**
   * Add `'unsafe-inline'` to script-src so author-pasted inline `<script>`
   * blocks in customHeadHtml / customBodyEndHtml can execute. Should only be
   * set on public (non-frame-protected) pages, and only when the author has
   * actually configured code injection — see `secureHeadersMiddleware`.
   */
  allowInlineScript?: boolean;
}

export interface ContentSecurityPolicyDirectives {
  defaultSrc: string[];
  scriptSrc: string[];
  styleSrc: string[];
  imgSrc: string[];
  mediaSrc: string[];
  fontSrc: string[];
  connectSrc: string[];
  frameSrc?: string[];
  objectSrc: string[];
  baseUri: string[];
  formAction: string[];
  frameAncestors?: string[];
}

function appendUnique(sources: string[], value: string | null): void {
  if (!value || sources.includes(value)) return;
  sources.push(value);
}

export function buildCspDirectives(
  input: CspBuildInput,
): ContentSecurityPolicyDirectives {
  const {
    isFrameProtected,
    assetOrigin,
    uploadConnectSources,
    isDev,
    allowInlineScript,
  } = input;

  // Base script-src: same-origin, Datastar's `unsafe-eval` for data-on-* /
  // data-signals expressions, blob: for media workers (heic-to, mediabunny,
  // the inline image worker).
  const scriptSrc = ["'self'", "'unsafe-eval'", "blob:"];
  if (allowInlineScript) scriptSrc.push("'unsafe-inline'");
  appendUnique(scriptSrc, assetOrigin);

  const styleSrc = ["'self'", "'unsafe-inline'"];
  appendUnique(styleSrc, assetOrigin);

  const fontSrc = ["'self'"];
  appendUnique(fontSrc, assetOrigin);

  const connectSrc = isDev ? ["'self'", "ws:"] : ["'self'"];
  for (const src of uploadConnectSources) appendUnique(connectSrc, src);

  // On public (non-admin) pages, allow third-party iframes, scripts,
  // stylesheets, fonts, and fetch endpoints so embeds and code-injection
  // HTML work. Admin pages stay tight.
  let frameSrc: string[] | undefined;
  if (!isFrameProtected) {
    frameSrc = ["'self'", "https:"];
    appendUnique(scriptSrc, "https:");
    appendUnique(styleSrc, "https:");
    appendUnique(fontSrc, "https:");
    appendUnique(connectSrc, "https:");
  }

  const directives: ContentSecurityPolicyDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc,
    styleSrc,
    imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
    mediaSrc: ["'self'", "data:", "blob:", "https:", "http:"],
    fontSrc,
    connectSrc,
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  };

  if (frameSrc) directives.frameSrc = frameSrc;
  if (isFrameProtected) directives.frameAncestors = ["'none'"];

  return directives;
}
