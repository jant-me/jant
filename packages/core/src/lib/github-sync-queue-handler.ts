/**
 * Cloudflare Queue batch handler for GitHub Sync jobs.
 *
 * This module bridges the CF Queue consumer interface with the
 * generic sync worker. It creates a runtime per-batch to access
 * services and configuration.
 */

import { createRequestRuntime } from "../runtime/index.js";
import { processGitHubSyncJob } from "./github-sync-worker.js";
import { getGitHubAppConfig } from "./env.js";
import type { JobPayload } from "./job-queue.js";
import type { Bindings } from "../types/bindings.js";

/**
 * Handle a batch of messages from a Cloudflare Queue.
 *
 * Each message is expected to be a `JobPayload` object.
 */
export async function handleQueueBatch(
  batch: MessageBatch<unknown>,
  env: Record<string, unknown>,
): Promise<void> {
  // We need a runtime to access services. Use a synthetic URL since
  // queue handlers don't have an incoming request.
  const siteOrigin =
    typeof env.SITE_ORIGIN === "string" && env.SITE_ORIGIN
      ? env.SITE_ORIGIN
      : "http://localhost";

  const runtime = await createRequestRuntime(env as Bindings, siteOrigin);

  for (const message of batch.messages) {
    const payload = message.body as JobPayload;
    try {
      await processGitHubSyncJob(
        payload,
        runtime.services,
        payload.siteId,
        {
          siteName: "",
          siteUrl: siteOrigin,
          siteDescription: "",
          siteLanguage: "",
          showJantBrandingOnHome: false,
          homeDefaultView: "",
          siteFooter: "",
          showHeaderAvatar: false,
          siteAvatarUrl: "",
          themeId: "",
          defaultThemeId: "",
          fontThemeId: "",
          themeMode: "",
          noindex: false,
          navItems: [],
          pageSize: 50,
          archivePageSize: 50,
        },
        runtime.storage,
        getGitHubAppConfig(env),
      );
      message.ack();
    } catch {
      message.retry();
    }
  }
}
