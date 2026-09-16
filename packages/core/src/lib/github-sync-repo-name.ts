/**
 * The repository name Jant proposes for a site's GitHub Sync mirror.
 *
 * The settings page prefills it on github.com/new, and a site export with no
 * repository behind it uses it as the Worker name in `wrangler.jsonc`.
 * Cloudflare names a Worker imported from a repository after the repository,
 * so an export and a repository created with the default name agree without
 * anyone editing either.
 */

/** Used when the site URL yields no host label. */
const FALLBACK_REPO_NAME = "jant-site-sync";

/**
 * Derive the default repository name for a site's sync mirror.
 *
 * Uses the first DNS label of the site's host — a stable, URL-safe
 * identifier tied to this Jant instance. A leading `www` is skipped: it
 * names nothing about the site, and every `www.` site would otherwise
 * propose the same `www-jant-sync`. It is kept when only a top-level domain
 * follows it, since that label would say even less. The `-jant-sync` suffix
 * tells the sync mirror apart from a user's own `{slug}-jant` source repo.
 *
 * @param siteUrl - The site's public URL.
 * @returns A GitHub-safe repository name; `jant-site-sync` when the URL has
 *   no usable host.
 * @example
 * suggestSyncRepoName("https://notes.example.com"); // "notes-jant-sync"
 * suggestSyncRepoName("https://www.example.com"); // "example-jant-sync"
 */
export function suggestSyncRepoName(siteUrl: string): string {
  let labels: string[] = [];
  try {
    labels = new URL(siteUrl).host.split(".");
  } catch {
    /* fall through */
  }
  const [first = "", second = "", ...more] = labels;
  const label = first === "www" && more.length > 0 ? second : first;
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-jant-sync` : FALLBACK_REPO_NAME;
}
