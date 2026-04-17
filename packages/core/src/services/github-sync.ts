/**
 * GitHub Sync Service
 *
 * Handles bidirectional content synchronization between Jant and a GitHub repo.
 * Posts are serialized as Zola-format Markdown files (reusing the export format).
 *
 * Push (Jant → GitHub):
 *   - Always full sync: regenerate Jant-managed files in a single atomic commit
 *   - Uses base_tree so untracked files in the repo (READMEs, CI, etc.) are preserved
 *   - Debounced: multiple rapid changes collapse into one sync
 *
 * Pull (GitHub → Jant):
 *   - Webhook-triggered: match modified files to existing posts by slug and update
 *   - Unknown files are skipped; new posts cannot be created from GitHub
 *   - File deletions are intentionally ignored to avoid catastrophic data loss
 *     (e.g. user deletes the repo → site wiped). Deletes must go through Jant's UI.
 *
 * Anti-loop: all commits from Jant include `[jant-sync]` in the message.
 * Incoming webhooks with this marker are skipped.
 */

import {
  createGitHubClient,
  parseRepoSlug,
  type GitHubClient,
  type GitHubPushEvent,
  type GitHubTreeItem,
} from "../lib/github-api.js";
import { getInstallationToken } from "../lib/github-app.js";
import type { GitHubAppEnvConfig } from "../lib/env.js";
import { parseFrontMatter, splitReplies } from "../lib/zola-markdown.js";
import { markdownToTiptapJson } from "../lib/markdown-to-tiptap.js";
import { createExportService, type SiteConfig } from "./export.js";
import type { PostService } from "./post.js";
import type { PathService } from "./path.js";
import type { CollectionService } from "./collection.js";
import type { MediaService } from "./media.js";
import type { SettingsService } from "./settings.js";
import type { StorageDriver } from "../lib/storage.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Marker included in commit messages to prevent webhook loops. */
export const SYNC_COMMIT_MARKER = "[jant-sync]";

/**
 * Path of the ownership marker file written at the repo root.
 *
 * Presence of this file (with a matching `site_id`) identifies the repo
 * as actively managed by a Jant site. Used to distinguish three states
 * during connect: empty repo, Jant-owned repo, foreign repo with existing
 * content. Also serves as the initialization file for empty repos so we
 * don't need a separate throwaway placeholder.
 */
export const JANT_SYNC_MARKER_PATH = ".jant-sync";

/** Marker file schema version. Bump on incompatible format changes. */
export const JANT_SYNC_MARKER_SCHEMA_VERSION = 2;

/**
 * Hard list of paths Jant fully owns and always overwrites on push.
 * Anything outside this set is user territory and preserved via base_tree.
 *
 * - `content/**` — posts, collections, sections (rendered by Zola)
 * - `themes/jant/**` — the packaged Jant theme (templates + static assets)
 * - `config.toml` — site config, including `theme = "jant"`
 * - `.gitignore`, `README.md` — scaffolded once, then kept in sync
 * - `.jant-sync` — ownership marker; written by this service, not by export
 *
 * The list is also stored in the marker itself (`managed_globs`) so future
 * schema bumps can diff the old and new sets to decide what needs cleanup.
 */
export const JANT_MANAGED_GLOBS = [
  "content/**",
  "themes/jant/**",
  "config.toml",
  ".gitignore",
  "README.md",
  ".jant-sync",
] as const;

/**
 * Paths that schema v1 used to own under the flat layout but schema v2
 * no longer writes. On the first v2 push against a v1-marked repo, these
 * are explicitly deleted so stale root templates can't shadow the new
 * `themes/jant/` theme (Zola's override rule puts root templates first).
 *
 * `static/custom.css` is included: v1 wrote Jant-admin custom CSS here, and
 * v2 writes it under `themes/jant/static/custom.css`. Leaving the legacy
 * copy around would cause it to win over the current admin value.
 */
const V1_LEGACY_PATHS = [
  "templates/base.html",
  "templates/archive.html",
  "templates/index.html",
  "templates/page.html",
  "templates/section.html",
  "templates/taxonomy_list.html",
  "templates/taxonomy_single.html",
  "templates/collection.html",
  "templates/featured.html",
  "templates/atom.xml",
  "templates/macros.html",
  "static/tokens.css",
  "static/style.css",
  "static/theme.css",
  "static/custom.css",
  "static/favicon.ico",
  "static/apple-touch-icon.png",
] as const;

/** Directory prefix for post files in the repo. */
const POST_DIR = "content/posts";

// ---------------------------------------------------------------------------
// Ownership marker
// ---------------------------------------------------------------------------

export interface JantSyncMarker {
  schema_version: number;
  site_id: string;
  site_host: string;
  created_at: number;
  /**
   * Paths Jant claims ownership of in this repo. Optional on v1 markers
   * (did not exist); required by writers from v2 onward so future pushes
   * can detect layout migrations.
   */
  managed_globs?: readonly string[];
}

export type RepoClassification =
  | { kind: "empty" }
  | { kind: "owned"; marker: JantSyncMarker }
  | { kind: "owned-by-other-site"; marker: JantSyncMarker }
  | { kind: "foreign"; defaultBranch: string };

function parseMarker(text: string): JantSyncMarker | null {
  try {
    const parsed = JSON.parse(text) as Partial<JantSyncMarker>;
    if (
      typeof parsed.site_id === "string" &&
      typeof parsed.site_host === "string" &&
      typeof parsed.created_at === "number" &&
      typeof parsed.schema_version === "number"
    ) {
      return parsed as JantSyncMarker;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function decodeMarkerContent(file: {
  content: string;
  encoding: string;
}): string {
  if (file.encoding === "base64") {
    try {
      // GitHub wraps base64 output at 60-char columns; strip whitespace.
      const cleaned = file.content.replace(/\s+/g, "");
      const binary = atob(cleaned);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return "";
    }
  }
  return file.content;
}

function formatMarker(marker: JantSyncMarker): string {
  // Pretty-print + trailing newline so the file renders nicely on GitHub
  // and behaves well with text-mode diffs.
  return `${JSON.stringify(marker, null, 2)}\n`;
}

function safeHost(siteUrl: string): string {
  try {
    return new URL(siteUrl).host;
  } catch {
    return "";
  }
}

/**
 * Classify a repository to decide how to proceed with a sync connection.
 *
 * - `empty`: repo has no commits on the default branch (or repo is brand new).
 * - `owned`: `.jant-sync` marker present with matching `site_id`.
 * - `owned-by-other-site`: `.jant-sync` present but `site_id` differs —
 *   another Jant site already backs up here, blocking the connect.
 * - `foreign`: non-empty repo without a marker — requires explicit
 *   user confirmation before connect.
 */
export async function classifyRepoForSync(
  client: GitHubClient,
  owner: string,
  repo: string,
  siteId: string,
): Promise<RepoClassification> {
  const repoInfo = await client.getRepo(owner, repo);
  const defaultBranch = repoInfo.default_branch;

  // Probe the default branch head. A missing ref indicates an empty repo.
  try {
    await client.getRef(owner, repo, `heads/${defaultBranch}`);
  } catch {
    return { kind: "empty" };
  }

  const markerFile = await client.getFileContent(
    owner,
    repo,
    JANT_SYNC_MARKER_PATH,
  );
  if (!markerFile) {
    return { kind: "foreign", defaultBranch };
  }

  const marker = parseMarker(decodeMarkerContent(markerFile));
  if (!marker) {
    // File exists but is malformed — treat as foreign so the user is
    // forced to explicitly confirm the overwrite.
    return { kind: "foreign", defaultBranch };
  }

  if (marker.site_id === siteId) {
    return { kind: "owned", marker };
  }
  return { kind: "owned-by-other-site", marker };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GitHubSyncAuthMode = "pat" | "app";

export interface GitHubSyncConfig {
  /** Auth path: "pat" uses the stored token; "app" uses the GitHub App installation. */
  authMode: GitHubSyncAuthMode;
  /** PAT string (only set when `authMode === "pat"`). */
  token?: string;
  /** GitHub App installation id (only set when `authMode === "app"`). */
  installationId?: string;
  repo: string; // "owner/repo"
  enabled: boolean;
  webhookId?: string;
  webhookSecret?: string;
  lastPushSha?: string;
}

export interface GitHubSyncService {
  /** Get the current sync configuration from settings. */
  getConfig(): Promise<GitHubSyncConfig | null>;

  /** Full push: regenerate all files and commit atomically. */
  pushFullSync(): Promise<{ commitSha: string }>;

  /** Process an incoming GitHub webhook push event. */
  handleWebhookPush(payload: GitHubPushEvent): Promise<void>;

  /** Setup: create webhook on the GitHub repo. */
  setupWebhook(callbackUrl: string): Promise<{ webhookId: number }>;

  /** Teardown: remove webhook and clear config. */
  teardownWebhook(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createGitHubSyncService(
  services: {
    posts: PostService;
    paths: PathService;
    collections: CollectionService;
    media: MediaService;
    settings: SettingsService;
  },
  siteId: string,
  siteConfig: SiteConfig,
  deps: {
    storage?: StorageDriver | null;
    /** GitHub App env config — required to create clients in "app" auth mode. */
    githubApp?: GitHubAppEnvConfig | null;
  } = {},
): GitHubSyncService {
  /**
   * Build the ownership marker for this push. Preserves `created_at`
   * from an existing marker (when readable) so the timestamp reflects
   * when this repo was first bound to this site, not the latest push.
   */
  function buildMarker(
    existingContent: string | null,
    now: number,
  ): JantSyncMarker {
    const existing = existingContent ? parseMarker(existingContent) : null;
    const preservedCreatedAt =
      existing && existing.site_id === siteId ? existing.created_at : now;
    return {
      schema_version: JANT_SYNC_MARKER_SCHEMA_VERSION,
      site_id: siteId,
      site_host: safeHost(siteConfig.siteUrl),
      created_at: preservedCreatedAt,
      managed_globs: [...JANT_MANAGED_GLOBS],
    };
  }
  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  async function loadConfig(): Promise<GitHubSyncConfig | null> {
    const [repo, enabled, authModeRaw] = await Promise.all([
      services.settings.get("GITHUB_SYNC_REPO"),
      services.settings.get("GITHUB_SYNC_ENABLED"),
      services.settings.get("GITHUB_SYNC_AUTH_MODE"),
    ]);

    if (!repo || enabled !== "true") return null;

    const authMode: GitHubSyncAuthMode = authModeRaw === "app" ? "app" : "pat";

    const [token, installationId, webhookId, webhookSecret, lastPushSha] =
      await Promise.all([
        services.settings.get("GITHUB_SYNC_TOKEN"),
        services.settings.get("GITHUB_SYNC_APP_INSTALLATION_ID"),
        services.settings.get("GITHUB_SYNC_WEBHOOK_ID"),
        services.settings.get("GITHUB_SYNC_WEBHOOK_SECRET"),
        services.settings.get("GITHUB_SYNC_LAST_PUSH_SHA"),
      ]);

    if (authMode === "pat" && !token) return null;
    if (authMode === "app" && !installationId) return null;

    return {
      authMode,
      token: token ?? undefined,
      installationId: installationId ?? undefined,
      repo,
      enabled: true,
      webhookId: webhookId ?? undefined,
      webhookSecret: webhookSecret ?? undefined,
      lastPushSha: lastPushSha ?? undefined,
    };
  }

  function createClient(config: GitHubSyncConfig): {
    client: GitHubClient;
    owner: string;
    repo: string;
  } {
    const parsed = parseRepoSlug(config.repo);
    if (!parsed) throw new Error(`Invalid repo slug: ${config.repo}`);

    let client: GitHubClient;
    if (config.authMode === "app") {
      if (!deps.githubApp) {
        throw new Error(
          "GitHub App is not configured on this deployment. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_SLUG to use App auth.",
        );
      }
      if (!config.installationId) {
        throw new Error("GitHub App installation id is missing.");
      }
      const app = deps.githubApp;
      const installationId = config.installationId;
      client = createGitHubClient(() =>
        getInstallationToken(app, installationId),
      );
    } else {
      if (!config.token) {
        throw new Error("GitHub sync PAT is missing.");
      }
      client = createGitHubClient(config.token);
    }

    return { client, owner: parsed.owner, repo: parsed.repo };
  }

  /**
   * Get the HEAD SHA, initializing an empty repo if needed.
   * GitHub's Git Trees API requires at least one commit to exist.
   */
  async function getOrInitHead(
    client: GitHubClient,
    owner: string,
    repo: string,
    defaultBranch: string,
    seedMarker: JantSyncMarker,
  ): Promise<{ sha: string }> {
    try {
      const ref = await client.getRef(owner, repo, `heads/${defaultBranch}`);
      return { sha: ref.sha };
    } catch {
      // Empty repo — seed it so the Git Trees API becomes available.
      // Write the ownership marker directly as the seed: it's the file
      // we need anyway, so no throwaway placeholder is required.
      await client.createOrUpdateFile(owner, repo, JANT_SYNC_MARKER_PATH, {
        content: formatMarker(seedMarker),
        message: `Initialize Jant sync ${SYNC_COMMIT_MARKER}`,
      });
      const ref = await client.getRef(owner, repo, `heads/${defaultBranch}`);
      return { sha: ref.sha };
    }
  }

  // -------------------------------------------------------------------
  // Service methods
  // -------------------------------------------------------------------

  return {
    getConfig: loadConfig,

    async pushFullSync() {
      const config = await loadConfig();
      if (!config) throw new Error("GitHub Sync is not configured");
      const { client, owner, repo } = createClient(config);

      // Generate full Zola site via the shared export service
      const exportService = createExportService(services, siteConfig, deps);
      const exportFiles = await exportService.generateZolaFiles();

      // Resolve HEAD before building the tree — needed both as the commit
      // parent / base_tree and to detect marker schema migrations.
      const repoInfo = await client.getRepo(owner, repo);
      const defaultBranch = repoInfo.default_branch;

      // Build marker up front so the seed commit and the tree commit share
      // the same created_at — avoids a one-second drift between init and
      // the first sync commit.
      const now = Math.floor(Date.now() / 1000);
      // Read existing marker (if any) to preserve created_at across pushes
      // and decide whether a schema-migration cleanup is needed.
      const existingMarkerBeforeInit = await client
        .getFileContent(owner, repo, JANT_SYNC_MARKER_PATH)
        .catch(() => null);
      const existingMarkerText = existingMarkerBeforeInit
        ? decodeMarkerContent(existingMarkerBeforeInit)
        : null;
      const existingMarker = existingMarkerText
        ? parseMarker(existingMarkerText)
        : null;
      const marker = buildMarker(existingMarkerText, now);

      const { sha: headSha } = await getOrInitHead(
        client,
        owner,
        repo,
        defaultBranch,
        marker,
      );

      // Convert to Git tree items. The ownership marker is always emitted;
      // `created_at` is preserved across pushes (Git dedupes identical
      // blobs by SHA, so a no-op marker push is still cheap).
      const treeItems: GitHubTreeItem[] = [
        {
          path: JANT_SYNC_MARKER_PATH,
          mode: "100644",
          type: "blob",
          content: formatMarker(marker),
        },
      ];

      // On the first push against a v1-marked repo, null out the legacy
      // flat-layout paths. Without this, root `templates/**` files would
      // shadow the new `themes/jant/` theme because Zola's override rule
      // picks root over theme. The cleanup runs exactly once: subsequent
      // pushes see schema_version === 2 and skip this branch.
      if (
        existingMarker &&
        existingMarker.site_id === siteId &&
        (existingMarker.schema_version ?? 1) < 2
      ) {
        for (const legacyPath of V1_LEGACY_PATHS) {
          treeItems.push({
            path: legacyPath,
            mode: "100644",
            type: "blob",
            sha: null,
          });
        }
      }

      for (const file of exportFiles) {
        if (typeof file.content === "string") {
          treeItems.push({
            path: file.path,
            mode: "100644",
            type: "blob",
            content: file.content,
          });
        } else {
          // Binary files need to be created as blobs first
          const blob = await client.createBlob(
            owner,
            repo,
            uint8ArrayToBase64(file.content),
            "base64",
          );
          treeItems.push({
            path: file.path,
            mode: "100644",
            type: "blob",
            sha: blob.sha,
          });
        }
      }

      // Base the new tree on the current HEAD's tree so files outside Jant's
      // managed paths (user-added READMEs, CI config, etc.) are preserved.
      const headCommit = await client.getCommit(owner, repo, headSha);
      const tree = await client.createTree(
        owner,
        repo,
        treeItems,
        headCommit.treeSha,
      );

      // Create commit
      const commit = await client.createCommit(owner, repo, {
        message: `Sync site ${SYNC_COMMIT_MARKER}`,
        tree: tree.sha,
        parents: [headSha],
      });

      // Update ref
      await client.updateRef(owner, repo, `heads/${defaultBranch}`, commit.sha);

      // Save last push SHA and timestamp
      await services.settings.set("GITHUB_SYNC_LAST_PUSH_SHA", commit.sha);
      await services.settings.set(
        "GITHUB_SYNC_LAST_PUSH_AT",
        String(Math.floor(Date.now() / 1000)),
      );

      return { commitSha: commit.sha };
    },

    async handleWebhookPush(payload) {
      // Skip commits from Jant itself
      const hasOwnCommits = payload.commits.some((c) =>
        c.message.includes(SYNC_COMMIT_MARKER),
      );
      if (hasOwnCommits && payload.commits.length === 1) return;

      // Collect modified/added post files from non-Jant commits.
      // Deletions are intentionally ignored — removing a file in Git must not
      // delete posts, so users can't wipe the site by deleting the repo.
      const modified = new Set<string>();

      for (const commit of payload.commits) {
        if (commit.message.includes(SYNC_COMMIT_MARKER)) continue;

        for (const file of [...commit.modified, ...commit.added]) {
          if (file.startsWith(`${POST_DIR}/`) && file.endsWith(".md")) {
            modified.add(file);
          }
        }
      }

      const config = await loadConfig();
      if (!config) return;
      const { client, owner, repo } = createClient(config);

      // Process modified files
      for (const filePath of modified) {
        const fileContent = await client.getFileContent(
          owner,
          repo,
          filePath,
          payload.after,
        );
        if (!fileContent) continue;

        // Decode base64 content
        const raw = decodeBase64Content(fileContent.content);
        const { frontMatter, body } = await parseFrontMatter(raw);

        const slug = frontMatter.slug;
        if (!slug) continue;

        // Find existing post by slug
        const pathRecord = await services.paths.getByPath(slug);
        if (!pathRecord?.postId) continue;

        const existingPost = await services.posts.getById(pathRecord.postId);
        if (!existingPost) continue;

        // Parse body (handle thread replies)
        const segments = splitReplies(body);
        const rootBody = segments[0]?.body ?? "";

        // Convert markdown to Tiptap JSON
        const tiptapBody = rootBody ? markdownToTiptapJson(rootBody) : null;

        // Build update data from front matter
        const updateData: Record<string, unknown> = {};
        if (tiptapBody !== null) updateData.body = tiptapBody;
        if (frontMatter.title !== undefined)
          updateData.title = frontMatter.title;
        if (frontMatter.extra?.link_url !== undefined) {
          updateData.url = frontMatter.extra.link_url;
        }
        if (frontMatter.extra?.quote_text !== undefined) {
          updateData.quoteText = frontMatter.extra.quote_text;
        }

        if (Object.keys(updateData).length > 0) {
          await services.posts.update(existingPost.id, updateData);
        }
      }
    },

    async setupWebhook(callbackUrl) {
      const config = await loadConfig();
      if (!config) throw new Error("GitHub Sync is not configured");
      const { client, owner, repo } = createClient(config);

      // Generate a random webhook secret
      const secretBytes = new Uint8Array(32);
      crypto.getRandomValues(secretBytes);
      const secret = Array.from(secretBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const webhook = await client.createWebhook(owner, repo, {
        url: callbackUrl,
        secret,
        events: ["push"],
      });

      // Save webhook config
      await services.settings.set("GITHUB_SYNC_WEBHOOK_SECRET", secret);
      await services.settings.set("GITHUB_SYNC_WEBHOOK_ID", String(webhook.id));

      return { webhookId: webhook.id };
    },

    async teardownWebhook() {
      const config = await loadConfig();
      if (!config) return;

      if (config.webhookId) {
        try {
          const { client, owner, repo } = createClient(config);
          await client.deleteWebhook(owner, repo, parseInt(config.webhookId));
        } catch {
          // Webhook may already be gone — ignore errors
        }
      }

      // Clear all sync settings
      await services.settings.set("GITHUB_SYNC_ENABLED", "false");
      await services.settings.set("GITHUB_SYNC_TOKEN", "");
      await services.settings.set("GITHUB_SYNC_REPO", "");
      await services.settings.set("GITHUB_SYNC_WEBHOOK_SECRET", "");
      await services.settings.set("GITHUB_SYNC_WEBHOOK_ID", "");
      await services.settings.set("GITHUB_SYNC_LAST_PUSH_SHA", "");
      await services.settings.set("GITHUB_SYNC_AUTH_MODE", "pat");
      await services.settings.set("GITHUB_SYNC_APP_INSTALLATION_ID", "");
    },
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function decodeBase64Content(content: string): string {
  // GitHub API returns base64 with newlines for readability
  const cleaned = content.replace(/\n/g, "");
  return decodeURIComponent(escape(atob(cleaned)));
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}
