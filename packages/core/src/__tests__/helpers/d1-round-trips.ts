/**
 * A D1 binding over better-sqlite3 that counts sequential round trips.
 *
 * On Workers every D1 call waits for the Worker↔D1 distance, so what a page
 * costs is how many of those waits it stacks end to end, not how many
 * statements it runs. This binding answers calls in waves: a call joins the
 * wave that is waiting to go out, and a wave goes out only once the code has
 * nothing left to issue without an answer. Reads started together share a
 * wave; a read that needs an earlier read's rows lands in the next one. The
 * number of waves a request takes is the number of round trips it would wait
 * through on D1, independent of how fast this machine is.
 *
 * `batch()` is one call, as it is on D1, and returns object rows the way D1
 * does, so a joined statement with clashing column names breaks here as it
 * would there.
 */

import type BetterSqlite3 from "better-sqlite3";

type SqliteDatabase = BetterSqlite3.Database;

interface PendingCall {
  sql: string;
  run(): void;
}

/** What one measured request sent to D1, wave by wave. */
export interface RoundTripTrace {
  /** Statements of each wave, in the order the waves went out. */
  waves: string[][];
}

function bindValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return value;
}

/**
 * Create a D1 binding over `sqlite` that records each round trip.
 *
 * @param sqlite - Database the binding reads and writes
 * @returns The binding, and `measure` to trace the calls one task makes
 * @example
 * ```ts
 * const d1 = createRoundTripD1(sqlite);
 * const { waves } = await d1.measure(() => app.fetch(request, { DB: d1.binding }));
 * ```
 */
export function createRoundTripD1(sqlite: SqliteDatabase) {
  let pending: PendingCall[] = [];
  let flushScheduled = false;
  let recording: string[][] | null = null;

  function flush() {
    flushScheduled = false;
    const wave = pending;
    pending = [];
    recording?.push(wave.map((call) => call.sql.replace(/\s+/g, " ").trim()));
    for (const call of wave) call.run();
  }

  function roundTrip<T>(sql: string, execute: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      pending.push({
        sql,
        run() {
          try {
            resolve(execute());
          } catch (error) {
            reject(error);
          }
        },
      });
      if (!flushScheduled) {
        flushScheduled = true;
        // A timer rather than a microtask, so reads a request starts together
        // across `await`s that settle without D1 still share the wave.
        setTimeout(flush, 1);
      }
    });
  }

  function runAll(sql: string, params: unknown[]) {
    const statement = sqlite.prepare(sql);
    const bound = params.map(bindValue);
    if (statement.reader) {
      return {
        results: statement.all(...bound) as Record<string, unknown>[],
        success: true,
        meta: { changes: 0, last_row_id: 0 },
      };
    }
    const info = statement.run(...bound);
    return {
      results: [] as Record<string, unknown>[],
      success: true,
      meta: {
        changes: info.changes,
        last_row_id: Number(info.lastInsertRowid),
      },
    };
  }

  class PreparedStatement {
    constructor(
      readonly sql: string,
      readonly params: unknown[] = [],
    ) {}

    bind(...params: unknown[]) {
      return new PreparedStatement(this.sql, params);
    }

    all() {
      return roundTrip(this.sql, () => runAll(this.sql, this.params));
    }

    run() {
      return roundTrip(this.sql, () => runAll(this.sql, this.params));
    }

    first(column?: string) {
      return roundTrip(this.sql, () => {
        const row = runAll(this.sql, this.params).results[0] ?? null;
        return row && column ? row[column] : row;
      });
    }

    raw(options?: { columnNames?: boolean }) {
      return roundTrip(this.sql, () => {
        const statement = sqlite.prepare(this.sql);
        const bound = this.params.map(bindValue);
        if (!statement.reader) {
          statement.run(...bound);
          return [];
        }
        const rows = statement.raw(true).all(...bound) as unknown[][];
        return options?.columnNames
          ? [statement.columns().map((column) => column.name), ...rows]
          : rows;
      });
    }
  }

  const database = {
    prepare: (sql: string) => new PreparedStatement(sql),
    batch: (statements: PreparedStatement[]) =>
      roundTrip(statements.map((statement) => statement.sql).join("; "), () => {
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((statement) =>
            runAll(statement.sql, statement.params),
          );
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      }),
    exec: (sql: string) => roundTrip(sql, () => sqlite.exec(sql)),
  };

  const binding = {
    ...database,
    withSession: () => ({ ...database, getBookmark: () => null }),
  } as unknown as D1Database;

  return {
    binding,
    /**
     * Run `task` and record every wave of D1 calls it makes.
     *
     * @param task - Work to trace; nothing else should use the binding meanwhile
     * @returns The task's result and its waves
     */
    async measure<T>(
      task: () => Promise<T>,
    ): Promise<{ result: T } & RoundTripTrace> {
      const waves: string[][] = [];
      recording = waves;
      try {
        return { result: await task(), waves };
      } finally {
        recording = null;
      }
    },
  };
}

/**
 * Render a trace as one line per statement, numbered by wave, for a failure
 * message that says where the rounds went.
 *
 * @param trace - Waves recorded by `measure`
 * @returns Readable listing
 */
export function formatRoundTripTrace(trace: RoundTripTrace): string {
  return trace.waves
    .map((wave, index) =>
      wave
        .map(
          (sql) => `  ${String(index + 1).padStart(2)}  ${sql.slice(0, 200)}`,
        )
        .join("\n"),
    )
    .join("\n");
}
