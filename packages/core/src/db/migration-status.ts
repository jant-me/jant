/**
 * Schema migrations a database hasn't applied yet
 *
 * `jant migrate` runs Drizzle's migrator. It records each migration it
 * applies with the journal's `when`, and on the next run applies every journal
 * entry later than the newest one recorded. The same comparison, made without
 * running anything, tells the Node runtime that the installed `@jant/core`
 * expects columns the database doesn't have yet: every page would fail on
 * them, so it refuses to start instead.
 *
 * Reading the journal and the database is the runtime's job; this module only
 * compares and words the result, so `/readyz` can use it on any runtime.
 */

import { getJantDocsUrl } from "../lib/jant-docs.js";

/** One entry of a bundled `meta/_journal.json`. */
export interface BundledMigration {
  /** The migration's file name without `.sql`. */
  tag: string;
  /** When drizzle-kit generated it, in milliseconds. */
  when: number;
}

/** The `code` of the error a Node start throws on an unmigrated database. */
export const PENDING_MIGRATIONS_ERROR_CODE = "JANT_PENDING_MIGRATIONS";

/**
 * List the bundled migrations Drizzle's migrator would apply next.
 *
 * @param bundled - The bundled journal's entries, in journal order
 * @param lastAppliedAt - The newest `created_at` the database recorded, or
 *   null when it recorded none
 * @returns The tags of the migrations still to apply, oldest first
 * @example
 * ```ts
 * listPendingMigrations(
 *   [{ tag: "0000_init", when: 1 }, { tag: "0001_add_x", when: 2 }],
 *   1,
 * ); // ["0001_add_x"]
 * ```
 */
export function listPendingMigrations(
  bundled: readonly BundledMigration[],
  lastAppliedAt: number | null,
): string[] {
  return bundled
    .filter(({ when }) => lastAppliedAt === null || when > lastAppliedAt)
    .map(({ tag }) => tag);
}

/**
 * Say which migrations are missing and how to apply them.
 *
 * @param pending - Tags of the migrations still to apply, oldest first
 * @returns One message for the startup log and `/readyz`
 * @example
 * ```ts
 * describePendingMigrations(["0034_add_x"]);
 * // "The database is missing 1 schema migration this version of Jant needs (0034_add_x). Run `jant migrate`, …"
 * ```
 */
export function describePendingMigrations(pending: readonly string[]): string {
  const count =
    pending.length === 1
      ? "1 schema migration"
      : `${pending.length} schema migrations`;
  const range =
    pending.length === 1
      ? pending[0]
      : `${pending[0]} through ${pending.at(-1)}`;

  return (
    `The database is missing ${count} this version of Jant needs (${range}). ` +
    "Run `jant migrate`, then start Jant again. " +
    "With Docker Compose, `docker compose up -d` runs it before the app starts; " +
    `without Compose, see ${getJantDocsUrl("upgrading#docker-without-compose")}.`
  );
}

/** Thrown when the Node runtime starts on a database with pending migrations. */
export class PendingMigrationsError extends Error {
  readonly code = PENDING_MIGRATIONS_ERROR_CODE;

  /**
   * @param pending - Tags of the migrations still to apply, oldest first
   */
  constructor(readonly pending: readonly string[]) {
    super(describePendingMigrations(pending));
    this.name = "PendingMigrationsError";
  }
}
