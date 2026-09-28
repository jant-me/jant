const NON_FEED_PATH_PREFIXES = ["/api", "/settings", "/compose", "/_"];

function hasPathPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Check whether an internal application path has the shape of an Atom feed
 * endpoint, without resolving it.
 *
 * The Worker response cache uses it to decide which requests may be served
 * from cache; what the response itself allows still decides whether one is
 * stored. It is not a routing decision: a custom URL can end in `/feed` and
 * be a post, which is why feed routes check `feedsPublished` themselves.
 *
 * @param path - Request pathname after any configured site prefix is removed
 * @returns Whether the path looks like a canonical or legacy feed URL
 * @example
 * ```ts
 * isRssFeedPath("/reading/feed"); // true
 * isRssFeedPath("/api/posts"); // false
 * ```
 */
export function isRssFeedPath(path: string): boolean {
  if (path === "/feed" || path.startsWith("/feed/")) return true;
  if (NON_FEED_PATH_PREFIXES.some((prefix) => hasPathPrefix(path, prefix))) {
    return false;
  }

  return path.endsWith("/feed") || path.endsWith("/feed/atom.xml");
}
