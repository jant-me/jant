import { describe, expect, it } from "vitest";
import {
  describePendingMigrations,
  listPendingMigrations,
  PENDING_MIGRATIONS_ERROR_CODE,
  PendingMigrationsError,
} from "../migration-status.js";

const BUNDLED = [
  { tag: "0000_init", when: 1000 },
  { tag: "0001_add_language", when: 2000 },
  { tag: "0002_add_smart_collection", when: 3000 },
];

describe("listPendingMigrations", () => {
  // Drizzle's migrator applies every entry later than the newest recorded
  // one, so the check has to read the same rule or it disagrees with
  // `jant migrate`.
  it("lists the migrations later than the newest one applied", () => {
    expect(listPendingMigrations(BUNDLED, 1000)).toEqual([
      "0001_add_language",
      "0002_add_smart_collection",
    ]);
  });

  it("lists every migration when none was recorded", () => {
    expect(listPendingMigrations(BUNDLED, null)).toEqual([
      "0000_init",
      "0001_add_language",
      "0002_add_smart_collection",
    ]);
  });

  it("lists none on an up-to-date database", () => {
    expect(listPendingMigrations(BUNDLED, 3000)).toEqual([]);
  });

  // A rollback to an older image leaves the database ahead of the code.
  // `jant migrate` has nothing to apply there, so it is not refused.
  it("lists none on a database a newer version migrated", () => {
    expect(listPendingMigrations(BUNDLED, 4000)).toEqual([]);
  });
});

describe("describePendingMigrations", () => {
  it("names the one missing migration and the command that applies it", () => {
    const message = describePendingMigrations(["0034_add_x"]);

    expect(message).toContain("missing 1 schema migration this version");
    expect(message).toContain("(0034_add_x)");
    expect(message).toContain("Run `jant migrate`");
    expect(message).toContain("`docker compose up -d`");
    expect(message).toContain(
      "https://jant.me/docs/upgrading#docker-without-compose",
    );
  });

  it("gives the range when several are missing", () => {
    expect(describePendingMigrations(["0031_a", "0032_b", "0033_c"])).toContain(
      "missing 3 schema migrations this version of Jant needs (0031_a through 0033_c)",
    );
  });
});

describe("PendingMigrationsError", () => {
  // `jant start` recognizes the refusal by this code: the CLI loads the
  // bundled runtime and can't import the class.
  it("carries the code jant start looks for", () => {
    const error = new PendingMigrationsError(["0034_add_x"]);

    expect(error.code).toBe(PENDING_MIGRATIONS_ERROR_CODE);
    expect(error.code).toBe("JANT_PENDING_MIGRATIONS");
    expect(error.pending).toEqual(["0034_add_x"]);
    expect(error.message).toBe(describePendingMigrations(["0034_add_x"]));
  });
});
