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
 *
 * Two scopes matter and they are not interchangeable. A *site* scope
 * answers "which accounts is this blog syncing through". A *user* scope
 * answers "which accounts has this person already authorized anywhere",
 * which is what the connect flow needs: a GitHub App installs once per
 * GitHub account, so someone who connected their first site can never
 * install it a second time — GitHub sends them to the installation's
 * Configure page and never calls back. Their other sites have to be able
 * to reuse that installation without leaving Jant.
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

/**
 * An installation as seen by one person rather than by one site: the
 * same installation may back several of their sites, so the site id
 * drops out and `addedAt` carries the most recent binding.
 */
export interface VisibleGitHubAppInstallation {
  installationId: string;
  account: GitHubInstallationAccount;
  /** Unix seconds — most recent binding of this installation to any of the user's sites. */
  addedAt: number;
}

export interface GitHubAppInstallationsService {
  /** Installations this site has authorized, newest-first by `addedAt`. */
  listInstallationsForSite(
    siteId: string,
  ): Promise<StoredGitHubAppInstallation[]>;
  /**
   * Installations authorized on any site this user is a member of,
   * deduplicated by installation and newest-first by `addedAt`.
   *
   * This is the set the connect flow may offer and act on: membership is
   * the tenancy boundary, so one person's sites share their GitHub
   * accounts while other tenants' installations stay invisible.
   */
  listInstallationsForUser(
    userId: string,
  ): Promise<VisibleGitHubAppInstallation[]>;
  /**
   * One installation from `listInstallationsForUser`, or `null` when the
   * user has no site bound to it. Routes use this to authorize an
   * `installationId` that arrived in a request.
   */
  findInstallationForUser(
    installationId: string,
    userId: string,
  ): Promise<VisibleGitHubAppInstallation | null>;
  /**
   * Installations the user's sites are *actively syncing through*, read
   * from each site's settings rather than from the junction table.
   *
   * The two can disagree: settings are written when a site connects,
   * the binding when it was installed, and a site that connected while
   * the binding write failed keeps syncing with nothing to show for it.
   * Callers use this to rebuild the missing row — they have to fetch the
   * account from GitHub, which is why this returns ids and not accounts.
   */
  listSyncingInstallationsForUser(
    userId: string,
  ): Promise<Array<{ siteId: string; installationId: string }>>;
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
   * Remove the installation from every site this user is a member of.
   *
   * Used when GitHub reports the installation as gone (401/404): the
   * binding that made it visible may live on another of the user's
   * sites, so clearing only the current site would leave a dead account
   * in their picker forever. Other tenants' bindings are left to the
   * App-level webhook, which sees the authoritative `installation.deleted`.
   */
  removeInstallationForUser(
    installationId: string,
    userId: string,
  ): Promise<void>;
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
  const { githubAppInstallation, settings, siteMembers } = databaseSchema;

  /**
   * Rows for every binding on a site the user belongs to. One join, not
   * a per-site fan-out — a user has few sites but the query shape is
   * what gets copied.
   */
  function selectUserBindings(userId: string, installationId?: string) {
    const scope = eq(siteMembers.userId, userId);
    return db
      .select({
        installationId: githubAppInstallation.installationId,
        accountLogin: githubAppInstallation.accountLogin,
        accountType: githubAppInstallation.accountType,
        accountAvatarUrl: githubAppInstallation.accountAvatarUrl,
        addedAt: githubAppInstallation.addedAt,
      })
      .from(githubAppInstallation)
      .innerJoin(
        siteMembers,
        eq(siteMembers.siteId, githubAppInstallation.siteId),
      )
      .where(
        installationId
          ? and(scope, eq(githubAppInstallation.installationId, installationId))
          : scope,
      );
  }

  /** Collapse per-site bindings into one entry per installation. */
  function toVisible(
    rows: Array<{
      installationId: string;
      accountLogin: string;
      accountType: string;
      accountAvatarUrl: string;
      addedAt: number;
    }>,
  ): VisibleGitHubAppInstallation[] {
    const byInstallation = new Map<string, VisibleGitHubAppInstallation>();
    for (const row of rows) {
      const entry = {
        installationId: row.installationId,
        account: {
          login: row.accountLogin,
          type: toAccountType(row.accountType),
          avatarUrl: row.accountAvatarUrl,
        },
        addedAt: row.addedAt,
      };
      const existing = byInstallation.get(row.installationId);
      if (!existing || existing.addedAt < entry.addedAt) {
        byInstallation.set(row.installationId, entry);
      }
    }
    return [...byInstallation.values()].sort((a, b) => b.addedAt - a.addedAt);
  }

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
      return rows.map(toStored).sort((a, b) => b.addedAt - a.addedAt);
    },

    async listInstallationsForUser(userId) {
      return toVisible(await selectUserBindings(userId));
    },

    async findInstallationForUser(installationId, userId) {
      const rows = await selectUserBindings(userId, installationId);
      return toVisible(rows)[0] ?? null;
    },

    async listSyncingInstallationsForUser(userId) {
      const rows = await db
        .select({
          siteId: settings.siteId,
          installationId: settings.value,
        })
        .from(settings)
        .innerJoin(siteMembers, eq(siteMembers.siteId, settings.siteId))
        .where(
          and(
            eq(siteMembers.userId, userId),
            eq(settings.key, "GITHUB_SYNC_APP_INSTALLATION_ID"),
          ),
        );
      return rows.filter((row) => row.installationId.trim().length > 0);
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

    async removeInstallationForUser(installationId, userId) {
      const memberSites = db
        .select({ siteId: siteMembers.siteId })
        .from(siteMembers)
        .where(eq(siteMembers.userId, userId));
      await db
        .delete(githubAppInstallation)
        .where(
          and(
            eq(githubAppInstallation.installationId, installationId),
            inArray(githubAppInstallation.siteId, memberSites),
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

/** The column is a checked enum; narrow it without trusting the read. */
function toAccountType(value: string): GitHubAccountType {
  return value === "Organization" ? "Organization" : "User";
}

function toStored(row: {
  installationId: string;
  siteId: string;
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string;
  addedAt: number;
}): StoredGitHubAppInstallation {
  return {
    installationId: row.installationId,
    siteId: row.siteId,
    account: {
      login: row.accountLogin,
      type: toAccountType(row.accountType),
      avatarUrl: row.accountAvatarUrl,
    },
    addedAt: row.addedAt,
  };
}
