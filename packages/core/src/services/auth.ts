/**
 * Auth Service
 *
 * Handles authentication-related business logic:
 * password reset token validation, password updates, session management,
 * and account deletion with full data wipe.
 */

import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  executeStatement,
  supportsDrizzleTransaction,
  type Database,
} from "../db/index.js";
import type { DatabaseDialect } from "../db/dialect.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import type { SettingsService } from "./settings.js";
import type { StorageDriver } from "../lib/storage.js";
import { SETTINGS_KEYS } from "../lib/constants.js";
import { hmacHex, timingSafeEqualText } from "../lib/crypto.js";
import {
  ConfigurationError,
  ValidationError,
  NotFoundError,
} from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";

/** Dependencies for account deletion */
export interface DeleteAccountDeps {
  storage?: StorageDriver | null;
}

export interface AuthService {
  /**
   * Validate a password reset token against the stored value.
   *
   * @param token - The reset token from the URL
   * @returns true if the token is valid and not expired
   */
  validateResetToken(token: string): Promise<boolean>;

  /**
   * Reset the admin user's password.
   *
   * Validates the token, hashes the new password, updates the account,
   * clears all sessions, and removes the reset token.
   *
   * @param token - The reset token (re-validated to prevent TOCTOU)
   * @param newPassword - The new plaintext password
   * @throws {ValidationError} if token is invalid or expired
   * @throws {NotFoundError} if no user account exists
   */
  resetPassword(token: string, newPassword: string): Promise<void>;

  /**
   * Derive the account-deletion CSRF token for a session.
   *
   * Derived, not stored: rendering the delete page is a GET, and a GET that
   * wrote a fresh token somewhere would invalidate every copy handed out
   * before it — a second tab, a prefetch, or a browser extension re-fetching
   * the page would silently break the button the author is looking at. Same
   * session in, same token out, however many times it is asked for.
   *
   * @param sessionId - The signed-in session this token is bound to
   * @returns The token to embed in the page
   */
  generateDeleteCsrfToken(sessionId: string): Promise<string>;

  /**
   * Validate an account-deletion CSRF token against the requesting session.
   *
   * @param token - The token submitted with the request
   * @param sessionId - The session the request arrived on
   * @returns `true` when the token belongs to this session
   */
  validateDeleteCsrfToken(token: string, sessionId: string): Promise<boolean>;

  /**
   * Delete all user data and reset the instance to a pristine state.
   *
   * This clears all content, site-scoped configuration, memberships, auth
   * data, and site container records so `/setup` can create a completely fresh
   * single-site instance with a new site identity.
   *
   * Optionally cleans up storage files.
   *
   * @param deps - Optional storage driver for file cleanup
   */
  deleteAllData(deps?: DeleteAccountDeps): Promise<void>;
}

export function createAuthService(
  db: Database,
  settings: SettingsService,
  config?: {
    databaseDialect?: DatabaseDialect;
    /** Signing key for derived tokens. Absent only where no route needs one. */
    authSecret?: string;
  },
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): AuthService {
  const {
    user,
    account,
    session,
    verification,
    media,
    collections,
    smartCollections,
    threadCollections,
    pathRegistry,
    collectionDirectoryItems: directoryItemsTable,
    navItems,
    siteMembers,
    siteDomains,
    sites,
    settings: settingsTable,
    apiTokens,
  } = databaseSchema;
  const databaseDialect = config?.databaseDialect ?? "sqlite";
  const authSecret = config?.authSecret;

  async function deleteDataRows(targetDb: Database): Promise<void> {
    // Junction/dependent tables first
    await targetDb.delete(threadCollections);
    await targetDb.delete(pathRegistry);
    await targetDb.delete(directoryItemsTable);
    await targetDb.delete(media);
    await targetDb.delete(navItems);

    // Posts use self-referential thread FKs plus a root/reply thread-shape
    // check. Flatten replies back into roots before deleting the rows.
    await executeStatement(
      targetDb,
      sql`UPDATE post SET reply_to_id = NULL, thread_id = id WHERE reply_to_id IS NOT NULL`,
    );
    await executeStatement(targetDb, sql`DELETE FROM post`);

    // Both kinds of collection, and smart ones first — a smart collection holds
    // a `collection_id`. There is no constraint forcing that order any more
    // (see the note on the column in `db/schema.ts`), but a reset that walks
    // every table by hand should not leave one of them to an implicit cascade
    // from `site` at the very end.
    await targetDb.delete(smartCollections);
    await targetDb.delete(collections);
    await targetDb.delete(apiTokens);
    await targetDb.delete(settingsTable);
    await targetDb.delete(siteMembers);

    // Auth tables
    await targetDb.delete(verification);
    await targetDb.delete(session);
    await targetDb.delete(account);
    await targetDb.delete(user);

    // Site container records last so a factory reset removes the current site
    // identity and any bound domains. A new site is only created when setup is
    // submitted again.
    await targetDb.delete(siteDomains);
    await targetDb.delete(sites);

    if (databaseDialect === "sqlite") {
      // FTS table is auto-cleaned by triggers when posts are deleted,
      // but run a rebuild to ensure consistency for SQLite.
      await executeStatement(
        targetDb,
        sql`INSERT INTO post_fts(post_fts) VALUES ('rebuild')`,
      );
    }
  }

  async function validateResetToken(token: string): Promise<boolean> {
    const stored = await settings.get(SETTINGS_KEYS.PASSWORD_RESET_TOKEN);
    if (!stored) return false;

    const separatorIndex = stored.lastIndexOf(":");
    const storedHash = stored.substring(0, separatorIndex);
    const expiry = parseInt(stored.substring(separatorIndex + 1), 10);
    const now = Math.floor(Date.now() / 1000);

    if (now > expiry) return false;

    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token),
    );
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return timingSafeEqualText(tokenHash, storedHash);
  }

  /**
   * The delete-account token for a session — a pure function of the session and
   * the server's signing key, so nothing has to be written down to check it
   * later. It stops being valid when the session does, which is the only
   * lifetime that means anything here: the token is a second factor on top of
   * the session cookie, useless to anyone who does not already hold it.
   */
  async function deriveDeleteCsrfToken(sessionId: string): Promise<string> {
    if (!authSecret) {
      throw new ConfigurationError(
        "AUTH_SECRET is required to protect account deletion.",
      );
    }

    return hmacHex(authSecret, `delete-account:${sessionId}`);
  }

  return {
    validateResetToken,

    async resetPassword(token, newPassword) {
      const isValid = await validateResetToken(token);
      if (!isValid) {
        throw new ValidationError("Invalid or expired reset token");
      }

      const hashedPw = await hashPassword(newPassword);

      // Get admin user (single-author system)
      const userResult = await db.select({ id: user.id }).from(user).limit(1);
      if (!userResult[0]) {
        throw new NotFoundError("User account");
      }
      const userId = userResult[0].id;

      // Update password
      await db
        .update(account)
        .set({ password: hashedPw })
        .where(
          and(eq(account.userId, userId), eq(account.providerId, "credential")),
        );

      // Clear all sessions
      await db.delete(session).where(eq(session.userId, userId));

      // Remove the reset token
      await settings.remove(SETTINGS_KEYS.PASSWORD_RESET_TOKEN);
    },

    async generateDeleteCsrfToken(sessionId) {
      return deriveDeleteCsrfToken(sessionId);
    },

    async validateDeleteCsrfToken(token, sessionId) {
      const expected = await deriveDeleteCsrfToken(sessionId);
      return timingSafeEqualText(token, expected);
    },

    async deleteAllData(deps) {
      // 1. Collect all storage keys for cleanup before deleting DB records
      if (deps?.storage) {
        const mediaRows = await db
          .select({
            storageKey: media.storageKey,
            posterKey: media.posterKey,
          })
          .from(media);

        const appleTouchKey = await settings.get("SITE_FAVICON_APPLE_TOUCH");
        const avatarKey = await settings.get("SITE_AVATAR");

        const keysToDelete = new Set<string>();
        for (const row of mediaRows) {
          keysToDelete.add(row.storageKey);
          if (row.posterKey) keysToDelete.add(row.posterKey);
        }
        if (appleTouchKey) keysToDelete.add(appleTouchKey);
        if (avatarKey) keysToDelete.add(avatarKey);

        // Delete storage files (best-effort, don't block on failures)
        const storageDriver = deps.storage;
        if (storageDriver) {
          await Promise.allSettled(
            [...keysToDelete].map((key) => storageDriver.delete(key)),
          );
        }
      }

      // 2. Delete DB records.
      //
      // Only the Postgres path should use Drizzle transactions here. SQLite
      // and D1 both run under the "sqlite" dialect, but their transaction
      // implementations differ:
      // - better-sqlite3 cannot use an async transaction callback safely
      // - D1 rejects SQL BEGIN/SAVEPOINT statements entirely
      //
      // Running the delete sequence directly keeps both SQLite runtimes
      // compatible while Postgres still gets an atomic reset.
      if (!supportsDrizzleTransaction(db, databaseDialect)) {
        await deleteDataRows(db);
        return;
      }

      await db.transaction(async (tx) => {
        await deleteDataRows(tx as unknown as Database);
      });
    },
  };
}
