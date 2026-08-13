import { createCloudflareRequestRuntime } from "./cloudflare.js";
import { createNodeRequestRuntime } from "./node.js";
import type { Bindings } from "../types/bindings.js";

/**
 * Whether a `Cookie` header carries a better-auth session token.
 *
 * Matched on the `.session_token` suffix so it holds for both the plain and
 * the `__Secure-`-prefixed cookie name. This is a cheap "probably signed in"
 * hint used to pick a database consistency mode — it does not verify the
 * cookie's signature, and it must not be used to make an auth decision.
 *
 * @param cookieHeader - Raw `Cookie` request header, if any
 * @returns `true` when a session token cookie appears to be present
 *
 * @example
 * ```ts
 * hasSessionCookie("__Secure-better-auth.session_token=abc"); // true
 * hasSessionCookie("theme=dark");                             // false
 * ```
 */
export function hasSessionCookie(
  cookieHeader: string | null | undefined,
): boolean {
  return !!cookieHeader?.includes(".session_token=");
}

export async function createRequestRuntime(
  env: Bindings,
  publicRequestUrl: string,
  request?: Request,
) {
  if (env.NODE_DATABASE || env.NODE_SQLITE) {
    return createNodeRequestRuntime(env, publicRequestUrl);
  }

  return createCloudflareRequestRuntime(env, publicRequestUrl, {
    anchorReadsToPrimary: hasSessionCookie(request?.headers.get("cookie")),
  });
}
