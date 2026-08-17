/**
 * Addresses the author pasted.
 *
 * Pickers ask "which page?" and the author often answers with a URL rather
 * than a title — they have the page open in another tab. Turning that answer
 * into something the path registry can resolve is the same job everywhere, and
 * it is fiddly enough (site prefix, language prefix, which hosts are ours) to
 * be worth doing in one place.
 */

import type { Context } from "hono";
import { z } from "zod";
import type { Bindings } from "../types/bindings.js";
import type { AppVariables } from "../types/app-context.js";
import { toInternalPath } from "./url.js";
import { languageUrlPrefixes } from "./view-language.js";

type AddressContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

/** Query shape of every "what is at this address?" endpoint. */
export const AddressQuerySchema = z.object({
  url: z.string().trim().min(1).max(2048),
});

/**
 * Convert an address into the internal path this site resolves it against.
 *
 * Accepts a path or a full URL on any host the site answers on — the
 * configured one *and* the host of the current request, because a hosted site
 * is routinely reached on a domain its canonical URL knows nothing about.
 *
 * @param c - Request context, after `withConfig()`
 * @param input - What the author typed or pasted
 * @returns Internal path rooted at `/`, or `null` when the address is not ours
 * @example
 * requestInternalPath(c, "https://example.com/en/about"); // "/about"
 * requestInternalPath(c, "https://elsewhere.com/about"); // null
 */
export function requestInternalPath(
  c: AddressContext,
  input: string,
): string | null {
  const { siteOrigin, sitePathPrefix } = c.var.appConfig;

  let requestOrigin = "";
  try {
    requestOrigin = new URL(c.req.url).origin;
  } catch {
    // A request URL that will not parse is not one we can match against.
  }

  return toInternalPath(input, {
    siteOrigins: [siteOrigin, requestOrigin].filter(Boolean),
    sitePathPrefix,
    languagePrefixes: languageUrlPrefixes(c.var.appConfig),
  });
}
