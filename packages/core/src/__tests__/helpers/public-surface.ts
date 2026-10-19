/**
 * The second level of `docs/compatibility.md`, read from the code.
 *
 * What changes only in a major release — the HTTP API, MCP, feed contents,
 * the command line, configuration, and the export format — is spread across
 * route registrations, Zod schemas, renderers, and registries. This module
 * reads each of them into one manifest: every leaf a sorted list of names, so
 * that "a later release keeps what an earlier one promised" means one thing
 * everywhere. `public-surface.test.ts` keeps the committed copy current and
 * holds it against the copy frozen at each release.
 *
 * The docs decide what is promised, so a few things the code has but the
 * docs leave out are declared here and kept out of the manifest: undocumented
 * routes, the export's theme-only fields, and the variables and options the
 * compatibility page names as unpromised. `api-docs.test.ts` and
 * `export-docs.test.ts` hold the first two lists to their docs pages, so a
 * promised name can't hide in one.
 *
 * Kept outside the `__tests__/*.test.ts` glob so importing it doesn't re-run
 * another file's tests.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";
import { listPublicCommandNames } from "../../../bin/lib/command-registry.js";
import { createApp } from "../../app.js";
import {
  toApiCollection,
  toApiDirectoryItem,
  toApiSmartCollection,
} from "../../lib/api-collections.js";
import { toApiCustomUrl } from "../../lib/api-custom-urls.js";
import { toApiMedia } from "../../lib/api-media.js";
import { toApiNavItem } from "../../lib/api-nav-items.js";
import { toApiAttachment, toApiPost } from "../../lib/api-posts.js";
import { toPublicPost } from "../../lib/api-public-posts.js";
import { toSearchApiResult } from "../../lib/api-search.js";
import {
  appearanceSettingKeys,
  editableSettingKeys,
  languageSettingKeys,
} from "../../lib/api-settings.js";
import { toApiThreadResponse } from "../../lib/api-threads.js";
import { RESERVED_PATHS } from "../../lib/constants.js";
import { ENV_RULES } from "../../lib/env.js";
import { parseFrontMatter } from "../../lib/hugo-markdown.js";
import type { ExportContentFile } from "../../services/export.js";
import {
  handleMcpHttpRequest,
  MCP_PROTOCOL_VERSION,
} from "../../services/mcp.js";
import type { AppConfig } from "../../types/config.js";
import { CONFIG_FIELDS, THEME_MODES } from "../../types/config.js";
import type { Post } from "../../types.js";
import { BUILTIN_COLOR_THEMES } from "../../ui/color-themes.js";
import { BUILTIN_FONT_THEMES } from "../../ui/font-themes.js";
import { makeCollection, makeMedia, makePost } from "./export-fixtures.js";
import { createRichFeedSite, exportRichSite } from "./rich-sites.js";

const CORE_DIR = resolve(import.meta.dirname, "../../..");

/** Environment variables a self-hosted site may set that `CONFIG_FIELDS` doesn't hold. */
export const PUBLIC_ENV_OUTSIDE_CONFIG_FIELDS = [
  "CORS_ORIGINS",
  "DATABASE_URL",
  "DATA_DIR",
  "DISCOVER_PING_URL",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_SLUG",
  "GITHUB_APP_WEBHOOK_SECRET",
  "HOST",
  "INTERNAL_ADMIN_TOKEN",
  // Read by the CLI and `jant start`, not the server.
  "JANT_ENV_FILE",
  "LOCAL_PUBLIC_URL",
  "LOCAL_STORAGE_PATH",
  "PORT",
  "RATE_LIMIT_ENABLED",
  "RATE_LIMIT_SEARCH_PER_MIN",
  "TELEGRAM_BOT_TOKENS",
  "TELEGRAM_WEBHOOK_SECRET",
  "TRUST_PROXY",
];

/**
 * `Bindings` members that are not documented settings: platform bindings,
 * values the runtime sets itself, development-only tokens, and the hosted
 * service's configuration.
 */
export const INTERNAL_BINDINGS = [
  "DB",
  "R2",
  "NODE_DATABASE",
  "NODE_SQLITE",
  "NODE_STARTED_AT",
  "DEV_API_TOKEN",
  "SITE_RESOLUTION_MODE",
  "HOSTED_CONTROL_PLANE_BASE_URL",
  "HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET",
  "HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL",
  "HOSTED_CONTROL_PLANE_INTERNAL_TOKEN",
  "HOSTED_CONTROL_PLANE_PROVIDER_NAME",
  "HOSTED_CONTROL_PLANE_SSO_SECRET",
];

/**
 * Documented variables that `docs/compatibility.md` lists as changing
 * without notice: they serve the public demo.
 */
const UNPROMISED_ENV = ["DEMO_EMAIL", "DEMO_MODE", "DEMO_PASSWORD"];

/**
 * Routes under `/api/` that `docs/API.md` leaves out, so they can change in
 * any release: the dashboard's own calls, and the sign-in form's. Every other
 * route outside `/api/internal/*` is documented (`api-docs.test.ts`).
 */
export const UNDOCUMENTED_API_ROUTES = [
  // better-auth's sign-in, which the sign-in page posts to.
  "POST /api/auth/sign-in/email",
  // The GitHub Sync settings page.
  "DELETE /api/github-sync",
  "GET /api/github-sync/status",
  "GET /api/github-sync/status/stream",
  "POST /api/github-sync/push",
  "POST /api/github-sync/setup",
  // The navigation manager's pickers.
  "GET /api/nav-items/pages",
  "GET /api/nav-items/resolve",
  // The command palette, which docs/compatibility.md names.
  "GET /api/palette",
  // Hints the dashboard stops showing once they're learned.
  "POST /api/settings/discovery/compose-open-shortcut",
  "POST /api/settings/discovery/slash-command",
  // The editor rehosting a pasted image.
  "POST /api/uploads/sideload",
];

/** A kind of file `site export` writes fields into. */
export type ExportFieldKind =
  "post" | "collection" | "smart_collection" | "data";

/**
 * Export fields that `docs/export-and-import.md` marks theme only, as dotted
 * paths: `media.id` is the `id` of each `media` entry. `collection` covers
 * both kinds of collection page. `export-docs.test.ts` holds this list to the
 * rows the reference marks.
 */
export const THEME_ONLY_EXPORT_FIELDS = {
  post: [
    "collections.title",
    "featured_post_ids",
    "featured_sort_at",
    "feed_id",
    "media.id",
    "media.position",
    "summary_text",
    "truncated",
  ],
  collection: ["entry_count", "outputs"],
  data: [
    "archive_default_layout",
    "archive_page_size",
    "directory.description_html",
    "directory.entry_count",
    "directory.recent_activity_iso",
    "directory.recent_activity_label",
    "directory.sequence",
    "directory.title",
    "favicon_version",
    "generated_at",
    "page_size",
    "rss_feed_limit",
    "site_footer_html",
  ],
} as const;

/**
 * Options that pick one site from a database holding several, which
 * `docs/compatibility.md` leaves out. `--path-prefix` only does that beside
 * `--host`; on `deploy` it overrides `SITE_PATH_PREFIX` and is promised.
 */
const SITE_PICKER_OPTIONS = ["--host", "--path-prefix", "--site"];

/** A command's promised options: its help's, without the site pickers. */
function promisedOptions(options: string[]): string[] {
  const picksSite = options.includes("--site") || options.includes("--host");
  return picksSite
    ? options.filter((option) => !SITE_PICKER_OPTIONS.includes(option))
    : options;
}

/**
 * `jant <command> --help`, as the CLI prints it.
 *
 * @param command - A space-separated command path, e.g. `site export`
 * @returns The help text
 * @example
 * ```ts
 * optionsInHelp(await readHelp("migrate")); // ["--local", "--node", …]
 * ```
 */
export async function readHelp(command: string): Promise<string> {
  const { stdout } = await promisify(execFile)(
    "node",
    ["bin/jant.js", ...command.split(" "), "--help"],
    { cwd: CORE_DIR, env: { ...process.env, JANT_ENV_FILE: "" } },
  );
  return stdout;
}

/**
 * The options a command's help defines: each line that opens with one.
 *
 * @param help - Output of `jant <command> --help`
 * @returns Long option names, sorted, `--help` left out
 * @example
 * ```ts
 * optionsInHelp("  -o, --output <dir>  Where to write"); // ["--output"]
 * ```
 */
export function optionsInHelp(help: string): string[] {
  const options = new Set<string>();
  for (const line of help.split("\n")) {
    const match = /^\s+(?:-[a-zA-Z], )?(--[a-z][a-z-]*)/.exec(line);
    if (match?.[1] && match[1] !== "--help") options.add(match[1]);
  }
  return [...options].sort();
}

/**
 * Every route under `/api/` outside `/api/internal/*`, as `METHOD /path`.
 * Middleware (`ALL`) is left out.
 *
 * @returns Sorted, without duplicates
 * @example
 * ```ts
 * listApiRoutes(); // ["DELETE /api/collections/:id", …]
 * ```
 */
export function listApiRoutes(): string[] {
  const routes = createApp()
    .routes.filter(
      (route) =>
        route.method !== "ALL" &&
        route.path.startsWith("/api/") &&
        !route.path.startsWith("/api/internal/"),
    )
    .map((route) => `${route.method} ${route.path}`);
  return [...new Set(routes)].sort();
}

const APP_CONFIG = {
  r2PublicUrl: "",
  s3PublicUrl: "",
  localPublicUrl: "",
  imageTransformUrl: "",
  sitePathPrefix: "",
  storageDriver: "r2",
} as unknown as AppConfig;

function apiPost(over: Partial<Post> = {}): Post {
  return makePost({
    language: "en",
    translationGroupId: null,
    quietReply: false,
    threadUpdatedAt: 1773014400,
    ...over,
  });
}

const textMedia = makeMedia({
  id: "med-text",
  mimeType: "text/markdown; charset=utf-8",
  mediaKind: "text",
  storageKey: "media/med-text.md",
  summary: "Notes",
  chars: 120,
});

/** Every key any of the variants carries. */
function keysOf(...variants: object[]): string[] {
  return [
    ...new Set(variants.flatMap((variant) => Object.keys(variant))),
  ].sort();
}

/**
 * The fields of each response object the API documents, read from the
 * builders in `lib/api-*.ts`. Each response is built in every variant that
 * changes its fields: each format, and `content=markdown`.
 *
 * @returns Field names per response, sorted
 * @example
 * ```ts
 * readApiResponseFields().post; // ["attachments", "body", …]
 * ```
 */
export function readApiResponseFields() {
  const postExtras = {
    threadPostCount: 1,
    attachments: [],
    collectionIds: [],
  };
  const related = { media: [], collections: [], threadPostCount: 1 };
  const root = apiPost();
  const respond = (item: Post) => ({ id: item.id });
  const navBase = {
    id: "nav-1",
    siteId: "site-test",
    label: "",
    url: "/ideas",
    placement: "header" as const,
    position: "a0",
    createdAt: 1773014400,
    updatedAt: 1773014400,
  };

  return {
    post: keysOf(
      toApiPost(apiPost(), postExtras),
      toApiPost(apiPost({ format: "quote" }), postExtras),
      toApiPost(apiPost(), postExtras, { content: "markdown" }),
    ),
    publicPost: keysOf(
      toPublicPost(apiPost(), related, APP_CONFIG),
      toPublicPost(apiPost({ format: "quote" }), related, APP_CONFIG),
      toPublicPost(apiPost(), related, APP_CONFIG, { content: "markdown" }),
    ),
    thread: keysOf(
      toApiThreadResponse(
        {
          root,
          postCount: 2,
          fold: {
            leadingReplies: [],
            trailingReplies: [],
            latestReply: root,
            firstHiddenReply: null,
            hiddenCount: 0,
          },
        },
        respond,
        respond,
      ),
    ),
    media: keysOf(
      toApiMedia(makeMedia(), APP_CONFIG),
      toApiMedia(textMedia, APP_CONFIG),
    ),
    attachment: keysOf(
      toApiAttachment(makeMedia(), APP_CONFIG),
      toApiAttachment(textMedia, APP_CONFIG),
    ),
    collection: keysOf(
      toApiCollection({
        ...makeCollection(),
        threadCount: 1,
        recentActivityAt: 1773014400,
      }),
    ),
    directoryItem: keysOf(
      toApiDirectoryItem({
        id: "cdi-1",
        siteId: "site-test",
        type: "link",
        collectionId: null,
        smartCollectionId: null,
        label: "Elsewhere",
        url: "https://example.com",
        description: null,
        position: "a0",
        createdAt: 1773014400,
        updatedAt: 1773014400,
      }),
    ),
    smartCollection: keysOf(
      toApiSmartCollection({
        id: "smc-1",
        siteId: "site-test",
        slug: "reading",
        title: "Reading",
        description: null,
        selection: {},
        sort: "newest",
        layout: null,
        createdAt: 1773014400,
        updatedAt: 1773014400,
        threadCount: 1,
        recentActivityAt: 1773014400,
      }),
    ),
    navItem: keysOf(
      toApiNavItem({ ...navBase, type: "system", systemKey: "archive" }),
      toApiNavItem({
        ...navBase,
        type: "collection",
        collectionId: "col-1",
        targetTitle: "Ideas",
      }),
      toApiNavItem({
        ...navBase,
        type: "smart_collection",
        smartCollectionId: "smc-1",
      }),
      toApiNavItem({ ...navBase, type: "page", postId: "pst-1" }),
    ),
    customUrl: keysOf(
      toApiCustomUrl({
        id: "pth-1",
        path: "old-post",
        targetType: "redirect",
        targetId: null,
        toPath: "/new-post",
        redirectType: 301,
        archiveQuery: null,
        createdAt: 1773014400,
      }),
    ),
    searchResult: keysOf(
      toSearchApiResult(apiPost(), "snippet"),
      toSearchApiResult(apiPost({ format: "quote" }), "snippet"),
    ),
  };
}

/** The names a feed writes. */
export interface FeedNames {
  /** Each element, by qualified name, with the attributes it carries. */
  elements: Map<string, Set<string>>;
  /** Each namespace declaration (`xmlns`, `xmlns:jant`) and its URI. */
  namespaces: Map<string, string>;
}

/**
 * Every element and attribute name in a feed, and the namespaces it
 * declares. The HTML inside CDATA sections is left out.
 *
 * @param xml - An Atom document
 * @returns The names it uses
 * @example
 * ```ts
 * readFeedNames(xml).elements.get("jant:thread"); // Set {"posts", "hidden", …}
 * ```
 */
export function readFeedNames(xml: string): FeedNames {
  const elements = new Map<string, Set<string>>();
  const namespaces = new Map<string, string>();
  const markup = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  for (const [, name = "", attrs = ""] of markup.matchAll(
    /<([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*\/?>/g,
  )) {
    const seen = elements.get(name) ?? new Set<string>();
    for (const [, attr = "", value = ""] of attrs.matchAll(
      /([\w:.-]+)="([^"]*)"/g,
    )) {
      if (attr === "xmlns" || attr.startsWith("xmlns:")) {
        namespaces.set(attr, value);
      } else {
        seen.add(attr);
      }
    }
    elements.set(name, seen);
  }
  return { elements, namespaces };
}

/** Every key path in a parsed value, arrays passed through: `media.alt`. */
function keyPaths(value: unknown, prefix = "", into = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) keyPaths(item, prefix, into);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      into.add(path);
      // A smart collection's conditions are the filter vocabulary, which
      // the archive documents; the reference names only `selection`.
      if (key !== "selection") keyPaths(nested, path, into);
    }
  }
  return into;
}

/**
 * The fields an export writes, by the kind of file: post files, collection
 * pages (by their `type`), and `data/jant.toml`. The theme's own section
 * pages are left out.
 *
 * @param files - Files from `generateHugoFiles()`
 * @returns Dotted field paths per kind
 * @example
 * ```ts
 * (await readExportFields(await exportRichSite())).post.has("media.alt"); // true
 * ```
 */
export async function readExportFields(
  files: ExportContentFile[],
): Promise<Record<ExportFieldKind, Set<string>>> {
  const fields: Record<ExportFieldKind, Set<string>> = {
    post: new Set(),
    collection: new Set(),
    smart_collection: new Set(),
    data: new Set(),
  };
  for (const file of files) {
    const content =
      typeof file.content === "string"
        ? file.content
        : new TextDecoder().decode(file.content);
    if (file.path === "data/jant.toml") {
      keyPaths(parseToml(content), "", fields.data);
    } else if (file.path.startsWith("content/") && file.path.endsWith(".md")) {
      const { frontMatter } = await parseFrontMatter(content);
      const kind = frontMatter.type;
      if (
        kind === "post" ||
        kind === "collection" ||
        kind === "smart_collection"
      ) {
        keyPaths(frontMatter, "", fields[kind]);
      }
    }
  }
  return fields;
}

/** Parameter names in a JSON Schema, nested ones as dotted paths. */
function schemaParameters(schema: unknown): string[] {
  const names = new Set<string>();
  const visit = (node: unknown, prefix: string) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      const branches = record[key];
      if (Array.isArray(branches)) {
        for (const branch of branches) visit(branch, prefix);
      }
    }
    visit(record.items, prefix);
    const properties = record.properties;
    if (properties && typeof properties === "object") {
      for (const [name, child] of Object.entries(properties)) {
        const path = prefix ? `${prefix}.${name}` : name;
        names.add(path);
        visit(child, path);
      }
    }
  };
  visit(schema, "");
  return [...names];
}

/** Each MCP tool `tools/list` advertises, with its parameter names. */
async function readMcpTools(): Promise<Record<string, string[]>> {
  const response = await handleMcpHttpRequest(
    {
      bodyText: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    },
    {} as Parameters<typeof handleMcpHttpRequest>[1],
  );
  const { result } = JSON.parse(response.body ?? "{}") as {
    result: { tools: Array<{ name: string; inputSchema: unknown }> };
  };
  return Object.fromEntries(
    result.tools.map((tool) => [tool.name, schemaParameters(tool.inputSchema)]),
  );
}

const colorThemeIds = BUILTIN_COLOR_THEMES.map((theme) => theme.id);
const fontThemeIds = BUILTIN_FONT_THEMES.map((theme) => theme.id);

/**
 * The values a variable or setting takes, where the code fixes them; an
 * empty list for free-form text and numbers.
 */
function acceptedValues(name: string): string[] {
  switch (name) {
    case "DEFAULT_THEME":
    case "THEME":
      return colorThemeIds;
    case "DEFAULT_FONT_THEME":
    case "FONT_THEME":
      return fontThemeIds;
    case "THEME_MODE":
      return [...THEME_MODES];
  }
  if (Object.hasOwn(ENV_RULES, name)) {
    const rule = ENV_RULES[name as keyof typeof ENV_RULES];
    if (rule.kind === "enum") return [...rule.options];
    if (rule.kind === "boolean") return ["false", "true"];
  }
  if (Object.hasOwn(CONFIG_FIELDS, name)) {
    const field: {
      editor?: { type: string; options?: readonly string[] };
      configEditorLink?: { type: string };
    } = CONFIG_FIELDS[name as keyof typeof CONFIG_FIELDS];
    if (field.editor?.type === "enum") return [...(field.editor.options ?? [])];
    if (
      field.editor?.type === "boolean" ||
      field.configEditorLink?.type === "boolean"
    ) {
      return ["false", "true"];
    }
  }
  return [];
}

/** A manifest of the public surface: names, nested by area. */
export interface PublicSurface {
  [key: string]: string[] | PublicSurface;
}

/** The same surface with every list sorted and deduplicated, keys in order. */
function normalize(surface: PublicSurface): PublicSurface {
  return Object.fromEntries(
    Object.keys(surface)
      .sort()
      .map((key) => {
        const value = surface[key] as string[] | PublicSurface;
        return [
          key,
          Array.isArray(value) ? [...new Set(value)].sort() : normalize(value),
        ];
      }),
  );
}

/**
 * Read the public surface from the code at head.
 *
 * Runs `jant <command> --help` for every public command, renders a feed, and
 * exports a site, so it takes a few seconds.
 *
 * @returns The manifest `fixtures/public-surface.json` holds
 * @example
 * ```ts
 * const surface = await buildPublicSurface();
 * surface.mcp; // { protocolVersions: [...], tools: {...} }
 * ```
 */
export async function buildPublicSurface(): Promise<PublicSurface> {
  const commands = listPublicCommandNames();
  const helps = await Promise.all(commands.map((command) => readHelp(command)));

  const environment = new Set(PUBLIC_ENV_OUTSIDE_CONFIG_FIELDS);
  for (const field of Object.values(CONFIG_FIELDS)) {
    if ("internal" in field && field.internal) continue;
    for (const name of "envKeys" in field ? field.envKeys : []) {
      environment.add(name);
    }
  }
  for (const name of UNPROMISED_ENV) environment.delete(name);
  const settings = [
    ...editableSettingKeys,
    ...appearanceSettingKeys,
    ...languageSettingKeys,
  ];

  const undocumented = new Set(UNDOCUMENTED_API_ROUTES);

  const { request } = await createRichFeedSite();
  const feed = readFeedNames(await (await request("/latest/feed")).text());

  const exported = await readExportFields(await exportRichSite());
  const promisedExport = (kind: ExportFieldKind) => {
    const themeOnly: readonly string[] =
      THEME_ONLY_EXPORT_FIELDS[
        kind === "smart_collection" ? "collection" : kind
      ];
    return [...exported[kind]].filter((path) => !themeOnly.includes(path));
  };

  return normalize({
    cli: Object.fromEntries(
      commands.map((command, index) => [
        command,
        promisedOptions(optionsInHelp(helps[index] ?? "")),
      ]),
    ),
    configuration: {
      environment: Object.fromEntries(
        [...environment].map((name) => [name, acceptedValues(name)]),
      ),
      settings: Object.fromEntries(
        settings.map((name) => [name, acceptedValues(name)]),
      ),
      reservedPaths: [...RESERVED_PATHS],
    },
    http: {
      endpoints: listApiRoutes().filter((route) => !undocumented.has(route)),
      responses: readApiResponseFields(),
    },
    mcp: {
      protocolVersions: [MCP_PROTOCOL_VERSION],
      tools: await readMcpTools(),
    },
    feed: {
      namespaces: Object.fromEntries(
        [...feed.namespaces].map(([name, uri]) => [name, [uri]]),
      ),
      elements: Object.fromEntries(
        [...feed.elements].map(([name, attrs]) => [name, [...attrs]]),
      ),
    },
    export: {
      post: promisedExport("post"),
      collection: promisedExport("collection"),
      smart_collection: promisedExport("smart_collection"),
      data: promisedExport("data"),
    },
  });
}

/** The manifest file inside a release's fixture directory. */
export const PUBLIC_SURFACE_FILE = "public-surface.json";

/**
 * What a later manifest dropped: each key of `baseline` that `head` lacks,
 * and each name in a `baseline` list that `head`'s list lacks. Additions are
 * not reported.
 *
 * @param baseline - The manifest a release froze
 * @param head - The manifest read at head
 * @returns One line per removal: `mcp.tools.jant_posts_list: limit`, or the
 *   path alone when a whole key is gone
 * @example
 * ```ts
 * findRemovals({ cli: { start: ["--port"] } }, { cli: { start: [] } });
 * // ["cli.start: --port"]
 * ```
 */
export function findRemovals(
  baseline: PublicSurface,
  head: PublicSurface,
  prefix = "",
): string[] {
  return Object.entries(baseline).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const current = Object.hasOwn(head, key) ? head[key] : undefined;
    if (Array.isArray(value)) {
      if (!Array.isArray(current)) return [path];
      return value
        .filter((name) => !current.includes(name))
        .map((name) => `${path}: ${name}`);
    }
    if (!current || Array.isArray(current)) return [path];
    return findRemovals(value, current, path);
  });
}

interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

function parseVersion(version: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

/** Semver order; a prerelease comes before its release. */
function compareVersions(a: Version, b: Version): number {
  const byNumber = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (byNumber !== 0) return byNumber;
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/**
 * The manifest head has to keep: the newest frozen one from a release of
 * `version`'s major, no later than `version`. Before 1.0 there is none, since
 * a 0.x minor release may change what the manifest covers.
 *
 * @param releasesDir - `fixtures/releases`, one directory per version
 * @param version - Head's version, from `packages/core/package.json`
 * @returns The baseline and the release that froze it, or null
 * @example
 * ```ts
 * findBaseline(RELEASES_DIR, "1.2.0")?.version; // "1.1.0"
 * ```
 */
export function findBaseline(
  releasesDir: string,
  version: string,
): { version: string; surface: PublicSurface } | null {
  const head = parseVersion(version);
  if (!head || head.major === 0) return null;
  const candidates = readdirSync(releasesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const parsed = parseVersion(entry.name);
      return parsed &&
        parsed.major === head.major &&
        compareVersions(parsed, head) <= 0 &&
        existsSync(join(releasesDir, entry.name, PUBLIC_SURFACE_FILE))
        ? [{ name: entry.name, parsed }]
        : [];
    })
    .sort((a, b) => compareVersions(b.parsed, a.parsed));
  const latest = candidates[0];
  if (!latest) return null;
  return {
    version: latest.name,
    surface: JSON.parse(
      readFileSync(join(releasesDir, latest.name, PUBLIC_SURFACE_FILE), "utf8"),
    ) as PublicSurface,
  };
}

/**
 * Pending changesets that make the next `@jant/core` release major: those
 * that bump `@jant/core`, or a package released in step with it, as `major`.
 *
 * @param changesetDir - The repository's `.changeset` directory
 * @returns File names, sorted
 * @example
 * ```ts
 * pendingMajorChangesets(join(REPO_ROOT, ".changeset")); // ["drop-v1-api.md"]
 * ```
 */
export function pendingMajorChangesets(changesetDir: string): string[] {
  const config = JSON.parse(
    readFileSync(join(changesetDir, "config.json"), "utf8"),
  ) as { fixed?: string[][] };
  const packages = new Set(
    config.fixed?.find((group) => group.includes("@jant/core")) ?? [
      "@jant/core",
    ],
  );
  return readdirSync(changesetDir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .filter((name) => {
      const source = readFileSync(join(changesetDir, name), "utf8");
      const frontMatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "";
      return [
        ...frontMatter.matchAll(/^\s*["']?([^"':\s]+)["']?\s*:\s*(\w+)/gm),
      ].some(([, name = "", bump]) => bump === "major" && packages.has(name));
    })
    .sort();
}
