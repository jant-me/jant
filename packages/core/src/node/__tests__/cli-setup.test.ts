import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../../bin/commands/setup.js";
import { verifyPassword } from "../../lib/password.js";
import type { Bindings } from "../../types.js";
import { migrate } from "../runtime.js";

const SITE_ID = "sit_01kn8jq3t4famtyg9hjd074ckr";
const ENV_KEYS = [
  "DATABASE_URL",
  "DATA_DIR",
  "SITE_ORIGIN",
  "SITE_RESOLUTION_MODE",
] as const;

function pipe(text: string) {
  return { stdin: Readable.from([text]) };
}

describe("jant setup", () => {
  const originalEnv = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  let root: string;
  let databasePath: string;

  beforeEach(async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    root = await mkdtemp(join(tmpdir(), "jant-setup-"));
    databasePath = join(root, "jant.sqlite");
    await migrate({ DATABASE_URL: `file:${databasePath}` } as Bindings);
    process.env.DATABASE_URL = `file:${databasePath}`;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function readDatabase<T>(read: (sqlite: Database.Database) => T): T {
    const sqlite = new Database(databasePath, { readonly: true });
    try {
      return read(sqlite);
    } finally {
      sqlite.close();
    }
  }

  it("sets up the install with the piped password", async () => {
    process.env.SITE_ORIGIN = "https://notes.example.com";

    const result = await run(
      [
        "--email",
        "Owner@Example.com",
        "--password-stdin",
        "--site-id",
        SITE_ID,
        "--site-name",
        "Field Notes",
      ],
      // `echo` ends the password with a line break that is not part of it.
      pipe("correct horse\n"),
    );

    expect(result).toEqual({ outcome: "created", siteId: SITE_ID });
    expect(console.log).toHaveBeenCalledWith(`Set up site ${SITE_ID}.`);

    const stored = readDatabase((sqlite) => ({
      email: sqlite.prepare('SELECT email FROM "user"').pluck().get(),
      hash: sqlite.prepare('SELECT password FROM "account"').pluck().get(),
      host: sqlite.prepare('SELECT host FROM "site_domain"').pluck().get(),
      status: sqlite
        .prepare(
          `SELECT value FROM "site_setting" WHERE "key" = 'ONBOARDING_STATUS'`,
        )
        .pluck()
        .get(),
    }));
    expect(stored).toMatchObject({
      email: "owner@example.com",
      host: "notes.example.com",
      status: "completed",
    });
    expect(
      await verifyPassword({
        hash: String(stored.hash),
        password: "correct horse",
      }),
    ).toBe(true);
  });

  it("changes nothing when run again", async () => {
    const args = ["--email", "owner@example.com", "--password-stdin"];
    const first = await run(args, pipe("correct horse"));
    const second = await run(args, pipe("a different password"));

    expect(second).toEqual({
      outcome: "already-set-up",
      siteId: first.siteId,
    });
    expect(console.log).toHaveBeenLastCalledWith(
      `Site ${first.siteId} was already set up. Nothing changed.`,
    );
  });

  it("refuses a password passed any way but standard input", async () => {
    await expect(
      run(["--email", "owner@example.com"], pipe("correct horse")),
    ).rejects.toThrow("Pass --password-stdin");
  });

  it("refuses to wait on a terminal for the password", async () => {
    const stdin = Object.assign(Readable.from([]), { isTTY: true });

    await expect(
      run(["--email", "owner@example.com", "--password-stdin"], { stdin }),
    ).rejects.toThrow("reads the password from a pipe");
  });

  it("rejects answers the setup screens would reject", async () => {
    const args = ["--email", "owner@example.com", "--password-stdin"];

    await expect(run(args, pipe("short"))).rejects.toThrow(
      "Password must be at least 8 characters",
    );
    await expect(
      run(
        [...args, "--site-id", "pst_01kn8jq3t4famtyg9hjd074ckr"],
        pipe("correct horse"),
      ),
    ).rejects.toThrow("Invalid ID");
    await expect(
      run([...args, "--time-zone", "Mars/Olympus"], pipe("correct horse")),
    ).rejects.toThrow("Choose a valid time zone.");

    expect(
      readDatabase((sqlite) =>
        sqlite.prepare('SELECT COUNT(*) FROM "user"').pluck().get(),
      ),
    ).toBe(0);
  });

  it("refuses to run without a Node database", async () => {
    delete process.env.DATABASE_URL;

    await expect(
      run(
        ["--email", "owner@example.com", "--password-stdin"],
        pipe("correct horse"),
      ),
    ).rejects.toThrow("jant setup runs against a Node database");
  });
});
