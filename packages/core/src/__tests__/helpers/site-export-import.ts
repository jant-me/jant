/**
 * Import a Jant site export into a throwaway Node SQLite site, the way
 * `mise run db-node-load-demo` does: migrate, set up, serve on a loopback
 * port, and run `jant site import` against that server.
 *
 * Every request off the machine goes to a closed port, so the export has to
 * import from its own files. The importer falls back to fetching a file from
 * the exported site's URL; with the network up, that fallback hid icons it
 * failed to find in the export.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CORE_DIR = resolve(import.meta.dirname, "../../..");

export interface SiteExportImportResult {
  /** SQLite file of the site the export went into. */
  databasePath: string;
  /** Exit status of the import script; `0` on success. */
  status: number | null;
  stdout: string;
  /** stdout and stderr together, for failure messages. */
  output: string;
  /** Spawn error, when the script could not run at all. */
  error: Error | undefined;
  /** Remove the temporary site. */
  cleanup: () => void;
}

/**
 * Import an export directory into a new temporary site.
 *
 * @param exportDir - The export to import; the canonical demo export when omitted
 * @returns The script's result and the database it wrote
 * @example
 * ```ts
 * const result = importSiteExportIntoTempSite(fixtureDir);
 * try {
 *   expect(result.status, result.output).toBe(0);
 * } finally {
 *   result.cleanup();
 * }
 * ```
 */
export function importSiteExportIntoTempSite(
  exportDir?: string,
): SiteExportImportResult {
  const dir = mkdtempSync(join(tmpdir(), "jant-load-demo-"));
  const databasePath = join(dir, "jant.sqlite");

  const env: Record<string, string | undefined> = {
    ...process.env,
    JANT_ENV_FILE: "",
    DATABASE_URL: `file:${databasePath}`,
    DATA_DIR: dir,
    LOCAL_STORAGE_PATH: join(dir, "media"),
    STORAGE_DRIVER: "local",
    // No announcement to a Discover directory from a test database.
    DISCOVER_PING_URL: "",
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "127.0.0.1",
  };
  delete env.SITE_RESOLUTION_MODE;
  for (const name of [
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "all_proxy",
    "ALL_PROXY",
  ]) {
    delete env[name];
  }

  const result = spawnSync(
    process.execPath,
    [
      "dev/run-script.mjs",
      "dev/scripts/import-node-demo-site-export.ts",
      ...(exportDir ? ["--path", exportDir] : []),
    ],
    { cwd: CORE_DIR, encoding: "utf8", env, timeout: 120_000 },
  );

  return {
    databasePath,
    status: result.status,
    stdout: result.stdout,
    output: `${result.stdout}\n${result.stderr}`,
    error: result.error,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
