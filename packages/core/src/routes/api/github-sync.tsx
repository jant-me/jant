/**
 * GitHub Sync API Routes
 *
 * Webhook receiver (HMAC-verified, no session auth) and admin endpoints
 * (session/token auth) for managing GitHub Sync configuration.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { verifyGitHubWebhookSignature } from "../../lib/webhook-signature.js";
import {
  isSyncPending,
  resolveJobQueue,
} from "../../lib/github-sync-trigger.js";
import { createGitHubClient, parseRepoSlug } from "../../lib/github-api.js";
import {
  createGitHubSyncService,
  SYNC_COMMIT_MARKER,
} from "../../services/github-sync.js";
import type { GitHubPushEvent } from "../../lib/github-api.js";
import { parseValidated } from "../../lib/schemas.js";
import { getGitHubAppConfig } from "../../lib/env.js";
import { buildSyncSiteConfig } from "../../lib/github-sync-site-config.js";
import { sse } from "../../lib/sse.js";
import { toPublicPath } from "../../lib/url.js";
import { I18nProvider } from "../../i18n/context.js";
import {
  GitHubSyncStatusCard,
  type GitHubSyncStatus,
} from "../../ui/dash/settings/GitHubSyncContent.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

// ---------------------------------------------------------------------------
// Webhook receiver — mounted in "no config" section
// ---------------------------------------------------------------------------

export const githubSyncWebhookRoutes = new Hono<Env>();

githubSyncWebhookRoutes.post("/webhook", async (c) => {
  // Prefer an app-level webhook secret when configured (GitHub App deployments
  // can set a single shared secret on the App and skip per-site secrets);
  // otherwise fall back to the per-site secret saved during setup.
  const app = getGitHubAppConfig(c.env);
  const secret =
    app?.webhookSecret ??
    (await c.var.services.settings.get("GITHUB_SYNC_WEBHOOK_SECRET"));
  if (!secret) {
    return c.json({ error: "GitHub Sync not configured" }, 404);
  }

  const signature = c.req.header("X-Hub-Signature-256") ?? "";
  const rawBody = await c.req.text();

  const valid = await verifyGitHubWebhookSignature(rawBody, signature, secret);
  if (!valid) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Only process push events
  const event = c.req.header("X-GitHub-Event");
  if (event !== "push") {
    return c.json({ ok: true, skipped: "not a push event" });
  }

  const payload = JSON.parse(rawBody) as GitHubPushEvent;

  // Skip commits from Jant itself (anti-loop)
  const allJantCommits = payload.commits.every((commit) =>
    commit.message.includes(SYNC_COMMIT_MARKER),
  );
  if (allJantCommits && payload.commits.length > 0) {
    return c.json({ ok: true, skipped: "jant-sync commits" });
  }

  // Enqueue pull job
  const queue = resolveJobQueue(c.env);
  await queue.enqueue({
    kind: "github-sync-pull",
    siteId: c.var.currentSite.id,
    data: {
      ref: payload.ref,
      before: payload.before,
      after: payload.after,
      commits: payload.commits,
    },
  });

  return c.json({ ok: true, queued: true });
});

// ---------------------------------------------------------------------------
// App-level webhook receiver
//
// Delivered by GitHub (self-hosted) or by the hosted control plane as a
// raw byte-for-byte forward (hosted). Authentication is the standard
// GitHub `X-Hub-Signature-256` HMAC over the raw body using
// `GITHUB_APP_WEBHOOK_SECRET` — no additional bearer token, so the
// auth model is symmetric between self-hosted and hosted deployments.
//
// This endpoint is host-agnostic: the request host is the control
// plane's host (hosted) or the core host (self-hosted), never a
// tenant host. `resolveRequestSite` exempts this path from host-based
// site resolution; handlers resolve affected sites from the payload
// via `listSitesForInstallation`.
// ---------------------------------------------------------------------------

interface InstallationEventPayload {
  action: string;
  installation?: {
    id: number | string;
  };
  repositories_removed?: Array<{ full_name?: string; name?: string }>;
}

githubSyncWebhookRoutes.post("/app-webhook", async (c) => {
  const app = getGitHubAppConfig(c.env);
  if (!app?.webhookSecret) {
    // Fast-fail before reading the body so misconfigured deployments
    // fail loudly on the first delivery instead of silently accepting
    // unsigned requests.
    return c.json({ error: "GitHub App webhook secret not configured" }, 404);
  }

  const signature = c.req.header("X-Hub-Signature-256") ?? "";
  const rawBody = await c.req.text();

  const valid = await verifyGitHubWebhookSignature(
    rawBody,
    signature,
    app.webhookSecret,
  );
  if (!valid) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const event = c.req.header("X-GitHub-Event");
  const deliveryId = c.req.header("X-GitHub-Delivery") ?? "";

  // Parse only after HMAC has passed so malformed payloads don't leak
  // error shape information to unauthenticated callers.
  let payload: InstallationEventPayload;
  try {
    payload = JSON.parse(rawBody) as InstallationEventPayload;
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const installationId = payload.installation?.id;
  const installations = c.var.services.githubAppInstallations;

  if (event === "installation") {
    if (!installationId) {
      return c.json({ ok: true, skipped: "no installation id" });
    }
    const id = String(installationId);
    switch (payload.action) {
      case "created":
        // The OAuth callback at `/settings/github-sync/app/callback`
        // is the source of truth for new bindings — it's the only
        // place where we know both `installation_id` AND the Jant
        // `site_id` that initiated the install. The webhook race is
        // expected: it may arrive before or after the callback finishes.
        return c.json({ ok: true, event, deliveryId, action: "logged" });
      case "deleted": {
        const affected = await installations.applyInstallationDeleted(id);
        return c.json({
          ok: true,
          event,
          deliveryId,
          action: "cleared",
          affectedSites: affected.length,
        });
      }
      case "suspend":
      case "unsuspend": {
        const affected = await installations.applySuspensionChange(
          id,
          payload.action === "suspend",
        );
        return c.json({
          ok: true,
          event,
          deliveryId,
          action: payload.action,
          affectedSites: affected.length,
        });
      }
      default:
        return c.json({ ok: true, skipped: `installation.${payload.action}` });
    }
  }

  if (event === "installation_repositories") {
    if (!installationId) {
      return c.json({ ok: true, skipped: "no installation id" });
    }
    if (payload.action !== "removed") {
      return c.json({
        ok: true,
        skipped: `installation_repositories.${payload.action}`,
      });
    }
    const removed =
      payload.repositories_removed
        ?.map((repo) => repo.full_name)
        .filter((name): name is string => typeof name === "string") ?? [];
    const affected = await installations.applyReposRemoved(
      String(installationId),
      removed,
    );
    return c.json({
      ok: true,
      event,
      deliveryId,
      action: "removed",
      affectedSites: affected.length,
    });
  }

  return c.json({ ok: true, skipped: event ?? "no event header" });
});

// ---------------------------------------------------------------------------
// Admin endpoints — mounted in "needs config" section
// ---------------------------------------------------------------------------

export const githubSyncAdminRoutes = new Hono<Env>();

const ConnectSchema = z.object({
  token: z.string().min(1),
  repo: z.string().min(3), // "o/r" minimum
});

// Connect: validate token, save config, create webhook
githubSyncAdminRoutes.post("/setup", requireAuthApi(), async (c) => {
  // PAT connect is disabled when a GitHub App is configured — see the
  // dashboard route for rationale.
  if (getGitHubAppConfig(c.env)) {
    return c.json(
      {
        error:
          "This deployment uses GitHub App authentication. Use the App install flow instead.",
      },
      400,
    );
  }

  const body = parseValidated(ConnectSchema, await c.req.json());
  const parsed = parseRepoSlug(body.repo);
  if (!parsed) {
    return c.json({ error: "Invalid repository format. Use owner/repo." }, 400);
  }

  // Validate token by fetching repo info
  const client = createGitHubClient(body.token);
  try {
    await client.getRepo(parsed.owner, parsed.repo);
  } catch {
    return c.json(
      {
        error:
          "Could not access the repository. Check your token and repo name.",
      },
      400,
    );
  }

  // Save token and repo
  await c.var.services.settings.set("GITHUB_SYNC_TOKEN", body.token);
  await c.var.services.settings.set("GITHUB_SYNC_REPO", body.repo);
  await c.var.services.settings.set("GITHUB_SYNC_AUTH_MODE", "pat");
  await c.var.services.settings.set("GITHUB_SYNC_APP_INSTALLATION_ID", "");
  await c.var.services.settings.set("GITHUB_SYNC_ENABLED", "true");

  // Build webhook callback URL
  const siteUrl = c.var.appConfig.siteUrl;
  const callbackUrl = `${siteUrl}/api/github-sync/webhook`;

  // Create webhook via the sync service
  const syncService = createGitHubSyncService(
    c.var.services,
    c.var.currentSite.id,
    buildSyncSiteConfig(c),
    { storage: c.var.storage, githubApp: getGitHubAppConfig(c.env) },
  );
  const { webhookId } = await syncService.setupWebhook(callbackUrl);

  return c.json({ ok: true, repo: body.repo, webhookId });
});

// Trigger full push sync
githubSyncAdminRoutes.post("/push", requireAuthApi(), async (c) => {
  const syncService = createGitHubSyncService(
    c.var.services,
    c.var.currentSite.id,
    buildSyncSiteConfig(c),
    { storage: c.var.storage, githubApp: getGitHubAppConfig(c.env) },
  );

  const config = await syncService.getConfig();
  if (!config) {
    return c.json({ error: "GitHub Sync not configured" }, 400);
  }

  const { commitSha } = await syncService.pushFullSync();
  return c.json({ ok: true, commitSha });
});

// Disconnect: remove webhook, clear config
githubSyncAdminRoutes.delete("/", requireAuthApi(), async (c) => {
  const syncService = createGitHubSyncService(
    c.var.services,
    c.var.currentSite.id,
    buildSyncSiteConfig(c),
    { storage: c.var.storage, githubApp: getGitHubAppConfig(c.env) },
  );
  await syncService.teardownWebhook();
  return c.json({ ok: true });
});

// Get sync status
githubSyncAdminRoutes.get("/status", requireAuthApi(), async (c) => {
  const status = await readGitHubSyncStatus(c);
  return c.json(status);
});

/**
 * Live status stream — drives the settings page's status card while a push
 * is running. Subscribed to via Datastar's `data-init="@get(...)"` on the
 * card element; each frame is a `patchElements` with `mode: outer` on the
 * stable id `#github-sync-status`.
 *
 * Loop ends as soon as `pending` is false (we still send one final frame
 * so the card flips from "Syncing…" to "N ago"), or after the hard budget
 * below if a sync is genuinely stuck — `isSyncPending` already self-heals
 * after the 10-minute stale window in `github-sync-trigger.ts`, which is
 * the upper bound callers rely on.
 */
githubSyncAdminRoutes.get("/status/stream", requireAuthApi(), async (c) => {
  const sitePathPrefix = c.var.appConfig.sitePathPrefix;
  const streamUrl = toPublicPath(
    "/api/github-sync/status/stream",
    sitePathPrefix,
  );

  // 5 minutes is comfortably above the realistic worst-case sync for a
  // normal site, and well under the 10-minute stale-flag timeout. If a
  // sync runs longer, the stream just closes; the user can reload and
  // resubscribe.
  const MAX_DURATION_MS = 5 * 60 * 1000;
  // 1.5s keeps the UI responsive without hammering the settings table.
  const POLL_INTERVAL_MS = 1500;

  return sse(c, async (stream) => {
    const startedAt = Date.now();
    let lastHtml: string | null = null;

    while (true) {
      const status = await readGitHubSyncStatus(c);
      const html = renderStatusCardHtml(c, status, streamUrl);

      if (html !== lastHtml) {
        stream.patchElements(html, {
          mode: "outer",
          selector: "#github-sync-status",
        });
        lastHtml = html;
      }

      // Sync completed: we've just sent the final "not pending" frame
      // (which renders the fresh lastPushAt and drops `data-init`, so
      // Datastar won't reopen). A brief beat lets the browser apply the
      // patch before the stream closes.
      if (!status.pending) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        break;
      }

      if (Date.now() - startedAt >= MAX_DURATION_MS) break;

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  });
});

// ---------------------------------------------------------------------------
// Shared helpers for status read + status-card rendering
// ---------------------------------------------------------------------------

async function readGitHubSyncStatus(
  c: Context<Env>,
): Promise<GitHubSyncStatus> {
  const [
    enabled,
    repo,
    lastPushSha,
    webhookId,
    lastPushAt,
    authMode,
    lastError,
  ] = await Promise.all([
    c.var.services.settings.get("GITHUB_SYNC_ENABLED"),
    c.var.services.settings.get("GITHUB_SYNC_REPO"),
    c.var.services.settings.get("GITHUB_SYNC_LAST_PUSH_SHA"),
    c.var.services.settings.get("GITHUB_SYNC_WEBHOOK_ID"),
    c.var.services.settings.get("GITHUB_SYNC_LAST_PUSH_AT"),
    c.var.services.settings.get("GITHUB_SYNC_AUTH_MODE"),
    c.var.services.settings.get("GITHUB_SYNC_LAST_ERROR"),
  ]);
  // Use isSyncPending (not raw flag) so clients don't get stuck on a dead
  // PENDING flag left by a crashed worker.
  const pending = await isSyncPending(c.var.services.settings);

  return {
    enabled: enabled === "true",
    repo: repo ?? null,
    lastPushSha: lastPushSha ?? null,
    webhookId: webhookId ?? null,
    lastPushAt: lastPushAt ? Number(lastPushAt) : null,
    authMode: authMode === "app" ? "app" : "pat",
    appConfigured: getGitHubAppConfig(c.env) !== null,
    pending,
    lastError: lastError || null,
  };
}

function renderStatusCardHtml(
  c: Context<Env>,
  status: GitHubSyncStatus,
  streamUrl: string,
): string {
  // Hono JSX elements stringify synchronously when the tree is sync. Our
  // status card has no async children, so `String(...)` returns a plain
  // HTML string. The I18nProvider binds the per-request i18n instance that
  // `useLingui()` inside the card relies on.
  return String(
    <I18nProvider c={c}>
      <GitHubSyncStatusCard status={status} streamUrl={streamUrl} />
    </I18nProvider>,
  );
}
