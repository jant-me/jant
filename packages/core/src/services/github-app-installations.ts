/**
 * GitHub App Installations Service
 *
 * Owns the `github_app_installation` junction table that models the
 * many-to-many relationship between GitHub App installations and Jant
 * sites: one GitHub account (installation) may be bound to multiple
 * sites, and one site may have multiple installations authorized.
 *
 * Routes call these methods instead of touching the settings table to
 * keep the model relational (one entry per (installation_id, site_id)
 * pair) instead of serialising a JSON list into a single settings row.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { now } from "../lib/time.js";

export type GitHubAccountType = "User" | "Organization";

export interface GitHubInstallationAccount {
  login: string;
  type: GitHubAccountType;
  avatarUrl: string;
}

export interface StoredGitHubAppInstallation {
  installationId: string;
  siteId: string;
  account: GitHubInstallationAccount;
  /** Unix seconds — first time this installation was bound to this site. */
  addedAt: number;
}

export interface GitHubAppInstallationsService {
  /** Installations this site has authorized, newest-first by `addedAt`. */
  listInstallationsForSite(
    siteId: string,
  ): Promise<StoredGitHubAppInstallation[]>;
  /** Site ids that share the given installation. */
  listSitesForInstallation(installationId: string): Promise<string[]>;
  /**
   * Insert or refresh an installation ↔ site binding.
   *
   * When the binding already exists, the account snapshot is refreshed
   * (login/avatar may drift when orgs are renamed) while `addedAt` is
   * preserved. New bindings record the current timestamp.
   */
  upsertInstallation(
    installationId: string,
    siteId: string,
    account: GitHubInstallationAccount,
  ): Promise<void>;
  /** Remove a single (installation, site) binding. */
  removeInstallation(installationId: string, siteId: string): Promise<void>;
  /**
   * Remove the installation from every site it's bound to and return
   * the previously-bound site ids so callers can fan out side effects
   * (e.g. clearing per-site settings).
   */
  removeInstallationEverywhere(installationId: string): Promise<string[]>;
  /**
   * Webhook fan-out: the GitHub App was uninstalled on the account.
   * Drops all bindings, clears each bound site's selected installation,
   * and disables sync. Returns affected site ids.
   */
  applyInstallationDeleted(installationId: string): Promise<string[]>;
  /**
   * Webhook fan-out: repositories were removed from the installation.
   * For every site bound to this installation whose stored
   * `GITHUB_SYNC_REPO` is in `removedFullNames`, clears the repo and
   * disables sync (keeps the installation link intact). Returns the
   * subset of bound site ids whose sync was actually affected.
   */
  applyReposRemoved(
    installationId: string,
    removedFullNames: readonly string[],
  ): Promise<string[]>;
  /**
   * Webhook fan-out: the installation was suspended or unsuspended on
   * GitHub. Toggles `GITHUB_SYNC_ENABLED` on every bound site. Returns
   * affected site ids.
   */
  applySuspensionChange(
    installationId: string,
    suspended: boolean,
  ): Promise<string[]>;
}

export function createGitHubAppInstallationsService(
  db: Database,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): GitHubAppInstallationsService {
  const { githubAppInstallation, settings } = databaseSchema;

  // Per-site settings mutation helpers. These sit alongside the
  // junction-table operations because the webhook fan-out inherently
  // couples "this installation went away" with "these sites' runtime
  // sync state must react" — keeping it in one service spares routes
  // from needing per-site DB access.
  async function writeSetting(
    siteId: string,
    key: string,
    value: string,
  ): Promise<void> {
    const timestamp = now();
    await db
      .insert(settings)
      .values({ siteId, key, value, updatedAt: timestamp })
      .onConflictDoUpdate({
        target: [settings.siteId, settings.key],
        set: { value, updatedAt: timestamp },
      });
  }

  async function readSettings(
    siteIds: readonly string[],
    keys: readonly string[],
  ): Promise<Map<string, Map<string, string>>> {
    if (siteIds.length === 0 || keys.length === 0) return new Map();
    const rows = await db
      .select({
        siteId: settings.siteId,
        key: settings.key,
        value: settings.value,
      })
      .from(settings)
      .where(
        and(
          inArray(settings.siteId, siteIds as string[]),
          inArray(settings.key, keys as string[]),
        ),
      );
    const bySite = new Map<string, Map<string, string>>();
    for (const row of rows) {
      const entry = bySite.get(row.siteId) ?? new Map<string, string>();
      entry.set(row.key, row.value);
      bySite.set(row.siteId, entry);
    }
    return bySite;
  }

  return {
    async listInstallationsForSite(siteId) {
      const rows = await db
        .select()
        .from(githubAppInstallation)
        .where(eq(githubAppInstallation.siteId, siteId));
      return rows
        .map(toStored)
        .sort((a, b) => b.addedAt - a.addedAt);
    },

    async listSitesForInstallation(installationId) {
      const rows = await db
        .select({ siteId: githubAppInstallation.siteId })
        .from(githubAppInstallation)
        .where(eq(githubAppInstallation.installationId, installationId));
      return rows.map((row) => row.siteId);
    },

    async upsertInstallation(installationId, siteId, account) {
      const timestamp = now();
      await db
        .insert(githubAppInstallation)
        .values({
          installationId,
          siteId,
          accountLogin: account.login,
          accountType: account.type,
          accountAvatarUrl: account.avatarUrl,
          addedAt: timestamp,
        })
        // Keep `addedAt` stable on re-install so the picker's ordering
        // doesn't reshuffle every time GitHub re-issues the id.
        .onConflictDoUpdate({
          target: [
            githubAppInstallation.installationId,
            githubAppInstallation.siteId,
          ],
          set: {
            accountLogin: account.login,
            accountType: account.type,
            accountAvatarUrl: account.avatarUrl,
          },
        });
    },

    async removeInstallation(installationId, siteId) {
      await db
        .delete(githubAppInstallation)
        .where(
          and(
            eq(githubAppInstallation.installationId, installationId),
            eq(githubAppInstallation.siteId, siteId),
          ),
        );
    },

    async removeInstallationEverywhere(installationId) {
      const rows = await db
        .select({ siteId: githubAppInstallation.siteId })
        .from(githubAppInstallation)
        .where(eq(githubAppInstallation.installationId, installationId));
      const siteIds = rows.map((row) => row.siteId);
      if (siteIds.length === 0) return [];

      await db
        .delete(githubAppInstallation)
        .where(eq(githubAppInstallation.installationId, installationId));
      return siteIds;
    },

    async applyInstallationDeleted(installationId) {
      const rows = await db
        .select({ siteId: githubAppInstallation.siteId })
        .from(githubAppInstallation)
        .where(eq(githubAppInstallation.installationId, installationId));
      const siteIds = rows.map((row) => row.siteId);
      if (siteIds.length === 0) return [];

      await db
        .delete(githubAppInstallation)
        .where(eq(githubAppInstallation.installationId, installationId));

      for (const siteId of siteIds) {
        await writeSetting(siteId, "GITHUB_SYNC_APP_INSTALLATION_ID", "");
        await writeSetting(siteId, "GITHUB_SYNC_ENABLED", "false");
      }
      return siteIds;
    },

    async applyReposRemoved(installationId, removedFullNames) {
      if (removedFullNames.length === 0) return [];
      const rows = await db
        .select({ siteId: githubAppInstallation.siteId })
        .from(githubAppInstallation)
        .where(eq(githubAppInstallation.installationId, installationId));
      const siteIds = rows.map((row) => row.siteId);
      if (siteIds.length === 0) return [];

      const removed = new Set(
        removedFullNames.map((name) => name.toLowerCase()),
      );
      const current = await readSettings(siteIds, ["GITHUB_SYNC_REPO"]);
      const affected: string[] = [];
      for (const siteId of siteIds) {
        const repo = current.get(siteId)?.get("GITHUB_SYNC_REPO");
        if (!repo) continue;
        if (!removed.has(repo.toLowerCase())) continue;
        // Keep the installation binding — the account still has the
        // App installed, only this specific repo is gone. Clearing the
        // repo and disabling sync lets the user pick a different repo
        // later without re-running the whole install flow.
        await writeSetting(siteId, "GITHUB_SYNC_REPO", "");
        await writeSetting(siteId, "GITHUB_SYNC_ENABLED", "false");
        affected.push(siteId);
      }
      return affected;
    },

    async applySuspensionChange(installationId, suspended) {
      const rows = await db
        .select({ siteId: githubAppInstallation.siteId })
        .from(githubAppInstallation)
        .where(eq(githubAppInstallation.installationId, installationId));
      const siteIds = rows.map((row) => row.siteId);
      if (siteIds.length === 0) return [];

      const nextValue = suspended ? "false" : "true";
      for (const siteId of siteIds) {
        await writeSetting(siteId, "GITHUB_SYNC_ENABLED", nextValue);
      }
      return siteIds;
    },
  };
}

function toStored(row: {
  installationId: string;
  siteId: string;
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string;
  addedAt: number;
}): StoredGitHubAppInstallation {
  const type: GitHubAccountType =
    row.accountType === "Organization" ? "Organization" : "User";
  return {
    installationId: row.installationId,
    siteId: row.siteId,
    account: {
      login: row.accountLogin,
      type,
      avatarUrl: row.accountAvatarUrl,
    },
    addedAt: row.addedAt,
  };
}
