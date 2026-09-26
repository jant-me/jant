/**
 * Plain-JS runtime mirror of `src/lib/hugo-markdown.ts` for the published
 * CLI. The `bin/` scripts ship as `.js` and are executed by Node directly
 * from `node_modules`, where Node 24 refuses to strip TypeScript types.
 * Importing the `.ts` source from these scripts fails with
 * ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, so we keep the runtime here
 * as real JavaScript.
 *
 * Keep this file in lock-step with `src/lib/hugo-markdown.ts` — same front
 * matter shapes, same key order, same YAML formatting options.
 */

const FRONT_MATTER_KEY_ORDER = [
  // Identity & routing
  "id",
  "title",
  "date",
  "updated",
  "slug",
  "type",
  "draft",
  "aliases",
  "feed_id",
  "build",

  // Post payload
  "format",
  "status",
  "visibility",
  "summary_text",
  "truncated",
  "link_url",
  "source_name",
  "source_url",
  "quote_text",
  "rating",
  "featured_at",
  "featured_post_ids",
  "featured_sort_at",
  "pinned_at",

  // Bookkeeping / attachments
  "root_aliases",
  "collections",
  "media",
];

/**
 * Parse front matter from a Markdown file. Accepts YAML (`---...---`) or
 * TOML (`+++...+++`) delimiters.
 *
 * @param {string} content
 * @returns {Promise<{ frontMatter: Record<string, unknown>, body: string }>}
 */
export async function parseFrontMatter(content) {
  const yamlMatch = content.match(
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/,
  );
  if (yamlMatch) {
    const { parse } = await import("yaml");
    const frontMatter = parse(yamlMatch[1] ?? "") ?? {};
    return { frontMatter, body: yamlMatch[2] ?? "" };
  }

  const tomlMatch = content.match(
    /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?([\s\S]*)$/,
  );
  if (tomlMatch) {
    const { parse } = await import("smol-toml");
    const frontMatter = parse(tomlMatch[1] ?? "");
    return { frontMatter, body: tomlMatch[2] ?? "" };
  }

  return { frontMatter: {}, body: content };
}

/**
 * Serialize a front-matter object as a YAML `---...---` block with the
 * canonical key order.
 *
 * @param {Record<string, unknown>} frontMatter
 * @returns {Promise<string>}
 */
export async function formatFrontMatter(frontMatter) {
  const { stringify } = await import("yaml");

  const ordered = {};
  for (const key of FRONT_MATTER_KEY_ORDER) {
    if (key in frontMatter) {
      const value = frontMatter[key];
      if (value !== undefined) ordered[key] = value;
    }
  }
  for (const key of Object.keys(frontMatter)) {
    if (key in ordered) continue;
    const value = frontMatter[key];
    if (value !== undefined) ordered[key] = value;
  }

  const yaml = stringify(ordered, {
    defaultKeyType: "PLAIN",
    defaultStringType: "QUOTE_DOUBLE",
    lineWidth: 0,
  });
  return `---\n${yaml.trimEnd()}\n---\n`;
}
