/**
 * Shared Hugo Markdown parsing utilities.
 *
 * Jant's static-site export targets Hugo. Posts are stored as branch
 * bundles (`content/{root-slug}/_index.md`) with each reply as a nested
 * leaf bundle (`content/{root-slug}/{reply-slug}/index.md`). Front matter
 * is flat YAML — no nested `extra` / `[extra.jant]` tables.
 *
 * This module owns the canonical shape of that front matter plus the
 * parser / formatter pair used by the exporter, the import CLI, and
 * GitHub sync.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Per-Thread collection membership metadata. Current exports write this
 * only on the Thread root bundle. Import also accepts legacy reply-level
 * entries and folds them into the root without losing metadata.
 */
export interface HugoCollectionRef {
  slug: string;
  /**
   * Denormalized collection title. Emitted so Hugo templates can render
   * the collection name directly from front matter without a site-wide
   * lookup. Import is authoritative via `slug`; `title` is refreshed on
   * every export and ignored on round-trip.
   */
  title?: string;
  collected_at?: string;
  position?: number;
  pinned_at?: string | null;
}

/**
 * Jant media attachment descriptor. Stored flat inside the `media:` front-
 * matter array. `src` is either:
 *   - a site-relative path (e.g. `/media/{id}.webp`) when the bytes are
 *     bundled under `static/media/` in the exported site, or
 *   - an absolute URL (e.g. `https://cdn.example.com/...`) when the media
 *     provider has a reachable public URL and we link rather than re-
 *     bundle the bytes.
 *
 * `poster` follows the same rule for video poster frames. Round-trip
 * fields (`provider`, `storage_key`, `poster_key`) preserve the original
 * provider coordinates so re-imports can rebuild the media record.
 */
export interface JantMedia {
  id: string;
  kind: "image" | "video" | "audio" | "document" | "file" | "text";
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  blurhash?: string;
  position?: number;
  poster?: string;
  original_name?: string;
  mime_type?: string;
  size?: number;
  duration_seconds?: number;
  waveform?: string;
  summary?: string;
  chars?: number;
  provider?: string;
  storage_key?: string;
  poster_key?: string;
  [key: string]: unknown;
}

/**
 * Hugo's `build` front-matter block. Used on reply leaf bundles to hide
 * them from the site's URL space while keeping them visible to the parent
 * page as `.Pages` entries.
 */
export interface HugoBuildOptions {
  render?: "always" | "never" | "link";
  list?: "always" | "local" | "never";
  publishResources?: boolean;
}

/**
 * Front matter shape shared by every content file Jant emits. Specific
 * page `type` values layer additional keys on top.
 */
export interface HugoFrontMatter {
  // Identity
  id?: string;
  title?: string;
  date?: string;
  updated?: string;
  slug?: string;
  type?: string;
  draft?: boolean;

  // Hugo routing
  aliases?: string[];
  build?: HugoBuildOptions;

  // Jant post payload (flat — no `extra` nesting)
  format?: string;
  status?: string;
  visibility?: string;
  summary_text?: string;
  link_url?: string;
  source_name?: string;
  source_url?: string;
  quote_text?: string;
  rating?: number | null;
  featured_at?: string | null;
  pinned_at?: string | null;
  /**
   * BCP 47 content language. Root bundles only — replies take the root's.
   */
  language?: string;
  /**
   * Opaque shared key linking posts that are translations of one another. Root
   * bundles only. Meaningful within one export; carried across so a full-site
   * restore keeps translated posts linked.
   */
  translation_group?: string;
  /**
   * Reply bundles only: the reply was published without announcing the Thread
   * on Latest. Round-tripped so a restore rebuilds the same ordering.
   */
  quiet_reply?: boolean;

  // Derived Featured Thread projection (root bundles only)
  featured_post_ids?: string[];
  featured_sort_at?: string;

  // Round-trip bookkeeping
  root_aliases?: string[];

  // Thread memberships (root bundles only) + attachments
  collections?: HugoCollectionRef[];
  media?: JantMedia[];

  // Escape hatch for page-specific export metadata.
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse front matter from a Markdown file.
 *
 * Hugo bundles emitted by Jant use YAML (`---...---`). TOML (`+++...+++`)
 * is also accepted so content authored by hand or migrated from an older
 * Zola export still parses cleanly.
 *
 * @param content - Raw file content
 * @returns Parsed front matter object and the remaining body text
 *
 * @example
 * ```ts
 * const { frontMatter, body } = await parseFrontMatter(fileContent);
 * console.log(frontMatter.slug, frontMatter.format);
 * ```
 */
export async function parseFrontMatter(
  content: string,
): Promise<{ frontMatter: HugoFrontMatter; body: string }> {
  // YAML front matter (---...---) — primary format.
  const yamlMatch = content.match(
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/,
  );
  if (yamlMatch) {
    const { parse } = await import("yaml");
    const frontMatter = (parse(yamlMatch[1] ?? "") ?? {}) as HugoFrontMatter;
    return { frontMatter, body: yamlMatch[2] ?? "" };
  }

  // TOML front matter (+++...+++) — legacy / migration fallback.
  const tomlMatch = content.match(
    /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?([\s\S]*)$/,
  );
  if (tomlMatch) {
    const { parse } = await import("smol-toml");
    const frontMatter = parse(tomlMatch[1] ?? "") as HugoFrontMatter;
    return { frontMatter, body: tomlMatch[2] ?? "" };
  }

  return { frontMatter: {}, body: content };
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

/**
 * Canonical key order for YAML front matter. Keys not listed here fall
 * through to the end in insertion order. Stable ordering is essential for
 * byte-level round-trip tests and clean diffs in the demo-source canonical
 * export.
 */
const FRONT_MATTER_KEY_ORDER: readonly string[] = [
  // Identity & routing
  "id",
  "title",
  "date",
  "updated",
  "slug",
  "type",
  "draft",
  "aliases",
  "build",

  // Post payload
  "format",
  "status",
  "visibility",
  "summary_text",
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
 * Serialize a front-matter object as a YAML `---...---` block with stable
 * key order. Keys with `undefined` values are skipped; `null` is emitted
 * explicitly so "cleared" round-trips survive.
 *
 * @example
 * ```ts
 * const block = await formatFrontMatter({ slug: "hello", date: "2026-01-01", type: "post" });
 * // ---
 * // title: ...
 * // date: 2026-01-01
 * // slug: hello
 * // type: post
 * // ---
 * ```
 */
export async function formatFrontMatter(
  frontMatter: HugoFrontMatter,
): Promise<string> {
  const { stringify } = await import("yaml");

  const ordered: Record<string, unknown> = {};
  for (const key of FRONT_MATTER_KEY_ORDER) {
    if (key in frontMatter) {
      const value = (frontMatter as Record<string, unknown>)[key];
      if (value !== undefined) ordered[key] = value;
    }
  }
  // Preserve any extra keys (page-type discriminators etc.) in insertion order.
  for (const key of Object.keys(frontMatter)) {
    if (key in ordered) continue;
    const value = (frontMatter as Record<string, unknown>)[key];
    if (value !== undefined) ordered[key] = value;
  }

  const yaml = stringify(ordered, {
    defaultKeyType: "PLAIN",
    defaultStringType: "QUOTE_DOUBLE",
    lineWidth: 0,
  });
  // `yaml.stringify` always ends with a newline; trim it so the block shape
  // below doesn't produce a trailing blank line.
  return `---\n${yaml.trimEnd()}\n---\n`;
}
