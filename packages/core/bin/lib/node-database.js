import { loadNodeRuntime } from "./load-node-runtime.js";
import { resolveDatabaseDialect, resolveDatabasePath } from "./node-sqlite.js";

function hasExecute(db) {
  return typeof db === "object" && db !== null && "execute" in db;
}

function hasTransaction(db) {
  return (
    typeof db === "object" &&
    db !== null &&
    "transaction" in db &&
    typeof db.transaction === "function"
  );
}

export async function openNodeDatabase(env = process.env) {
  const { createNodeBindings } = await loadNodeRuntime();
  const { bindings, close } = await createNodeBindings({
    ...(env ?? {}),
  });
  const database = bindings.NODE_DATABASE;

  if (!database) {
    await close();
    throw new Error("Node database binding is missing.");
  }

  return {
    bindings,
    database,
    location:
      resolveDatabaseDialect(bindings.DATABASE_URL ?? "") === "sqlite"
        ? resolveDatabasePath(bindings.DATABASE_URL ?? "")
        : (bindings.DATABASE_URL ?? ""),
    async close() {
      await close();
    },
    async query(sql) {
      const result = await database.rawQuery.prepare(sql).all();
      return result.results;
    },
    async execute(sql) {
      if (bindings.NODE_SQLITE) {
        bindings.NODE_SQLITE.exec(sql);
        return;
      }

      if (hasExecute(database.db)) {
        await database.db.execute(sql);
        return;
      }

      await database.db.run(sql);
    },
    async executeAtomically(sql) {
      if (bindings.NODE_SQLITE) {
        bindings.NODE_SQLITE.transaction(() => {
          bindings.NODE_SQLITE.exec(sql);
        })();
        return;
      }

      if (!hasTransaction(database.db)) {
        throw new Error(
          `Atomic SQL execution is unavailable for the ${database.dialect} Node database driver.`,
        );
      }

      await database.db.transaction(async (transaction) => {
        if (!hasExecute(transaction)) {
          throw new Error(
            `Atomic SQL execution is unavailable for the ${database.dialect} transaction driver.`,
          );
        }
        await transaction.execute(sql);
      });
    },
  };
}
