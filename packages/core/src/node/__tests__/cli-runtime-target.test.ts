import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findNodeEnvPath, loadNodeEnvFile } from "../../../bin/lib/node-env.js";
import {
  formatRuntimeBanner,
  resolveCliRuntime,
} from "../../../bin/lib/runtime-target.js";

describe("resolveCliRuntime", () => {
  it("prefers the Node database runtime when DATABASE_URL is present", () => {
    expect(
      resolveCliRuntime(
        { local: false, remote: false },
        { DATABASE_URL: "file:./jant.sqlite" },
      ),
    ).toBe("node");
  });

  it("allows explicit local D1 override", () => {
    expect(
      resolveCliRuntime(
        { local: true, remote: false },
        { DATABASE_URL: "file:./jant.sqlite" },
      ),
    ).toBe("d1-local");
  });

  it("prefers the Node database runtime when DATA_DIR is present", () => {
    expect(
      resolveCliRuntime(
        { local: false, remote: false },
        { DATA_DIR: "./data" },
      ),
    ).toBe("node");
  });

  it("rejects conflicting runtime flags", () => {
    expect(() => resolveCliRuntime({ local: true, remote: true }, {})).toThrow(
      /Choose only one of --local, --remote/,
    );
  });

  it("forces the Node runtime when --node is passed even without DATABASE_URL", () => {
    expect(resolveCliRuntime({ node: true }, {})).toBe("node");
  });
});

describe("loadNodeEnvFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "jant-env-"));
  });

  it("assigns missing keys but never overwrites existing ones", () => {
    const envPath = join(tmpDir, ".env.node");
    writeFileSync(
      envPath,
      [
        "# comment",
        "",
        "DATABASE_URL=postgres://example/db",
        "AUTH_SECRET=already-set-in-shell",
      ].join("\n"),
    );

    const env: Record<string, string> = {
      AUTH_SECRET: "shell-wins",
    };
    const result = loadNodeEnvFile(envPath, env);

    expect(result.found).toBe(true);
    expect(result.assignedKeys).toEqual(["DATABASE_URL"]);
    expect(result.skippedKeys).toEqual(["AUTH_SECRET"]);
    expect(env.DATABASE_URL).toBe("postgres://example/db");
    expect(env.AUTH_SECRET).toBe("shell-wins");
  });

  it("returns found=false when the file does not exist", () => {
    const result = loadNodeEnvFile(join(tmpDir, "missing"));
    expect(result.found).toBe(false);
    expect(result.assignedKeys).toEqual([]);
  });

  it("strips matching surrounding quotes from values", () => {
    const envPath = join(tmpDir, ".env.node");
    writeFileSync(
      envPath,
      [
        'STORAGE_DRIVER="local"',
        "SITE_NAME='Quoted Title'",
        "PUBLIC_URL=https://example.com",
        'MIXED="left only',
      ].join("\n"),
    );

    const env: Record<string, string> = {};
    loadNodeEnvFile(envPath, env);

    expect(env.STORAGE_DRIVER).toBe("local");
    expect(env.SITE_NAME).toBe("Quoted Title");
    expect(env.PUBLIC_URL).toBe("https://example.com");
    expect(env.MIXED).toBe('"left only');
  });
});

describe("findNodeEnvPath", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "jant-env-path-"));
  });

  it("finds .env.node in the given directory when JANT_ENV_FILE is unset", () => {
    const envPath = join(tmpDir, ".env.node");
    writeFileSync(envPath, "DATABASE_URL=file:./jant.sqlite\n");

    expect(findNodeEnvPath(tmpDir, {})).toBe(envPath);
  });

  it("loads nothing when JANT_ENV_FILE is empty", () => {
    writeFileSync(
      join(tmpDir, ".env.node"),
      "DATABASE_URL=file:./local.sqlite\n",
    );

    expect(findNodeEnvPath(tmpDir, { JANT_ENV_FILE: "" })).toBeNull();
    expect(findNodeEnvPath(tmpDir, { JANT_ENV_FILE: "  " })).toBeNull();
  });

  it("uses the file JANT_ENV_FILE names, resolved against the directory", () => {
    writeFileSync(
      join(tmpDir, ".env.node"),
      "DATABASE_URL=file:./local.sqlite\n",
    );
    const overridePath = join(tmpDir, "staging.env");
    writeFileSync(overridePath, "DATABASE_URL=postgres://example/db\n");

    expect(findNodeEnvPath(tmpDir, { JANT_ENV_FILE: "staging.env" })).toBe(
      overridePath,
    );
    expect(findNodeEnvPath(tmpDir, { JANT_ENV_FILE: overridePath })).toBe(
      overridePath,
    );
  });

  it("throws when JANT_ENV_FILE names a file that does not exist", () => {
    expect(() =>
      findNodeEnvPath(tmpDir, { JANT_ENV_FILE: "missing.env" }),
    ).toThrow(/JANT_ENV_FILE points at "missing.env"/);
  });
});

describe("formatRuntimeBanner", () => {
  const originalLog = console.log;
  beforeEach(() => {
    console.log = vi.fn();
  });
  afterEach(() => {
    console.log = originalLog;
  });

  it("describes a postgres node target", () => {
    const banner = formatRuntimeBanner("node", {
      DATABASE_URL: "postgresql://app@db.local:5432/jant_main",
    });
    expect(banner).toBe(
      "[jant] target = node (postgresql db.local:5432/jant_main)",
    );
  });

  it("describes a sqlite node target", () => {
    const banner = formatRuntimeBanner("node", {
      DATABASE_URL: "file:./local.sqlite",
    });
    expect(banner).toBe("[jant] target = node (sqlite file:./local.sqlite)");
  });

  it("describes wrangler local D1", () => {
    expect(formatRuntimeBanner("d1-local", {})).toBe(
      "[jant] target = local D1 (wrangler)",
    );
  });

  it("describes wrangler remote D1", () => {
    expect(formatRuntimeBanner("d1-remote", {})).toBe(
      "[jant] target = remote D1 (wrangler)",
    );
  });
});
