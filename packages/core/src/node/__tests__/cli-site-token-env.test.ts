import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run as runImportSite } from "../../../bin/commands/site/import.js";
import { run as runSiteExport } from "../../../bin/commands/site/export.js";
import {
  CLI_API_TOKEN_ENV_VAR,
  getCliApiToken,
} from "../../../bin/lib/cli-api-token.js";

describe("site CLI token env", () => {
  const tempDirs: string[] = [];
  const originalEnv = {
    API_TOKEN: process.env.API_TOKEN,
    JANT_API_TOKEN: process.env.JANT_API_TOKEN,
  };

  afterEach(async () => {
    if (originalEnv.API_TOKEN === undefined) {
      delete process.env.API_TOKEN;
    } else {
      process.env.API_TOKEN = originalEnv.API_TOKEN;
    }

    if (originalEnv.JANT_API_TOKEN === undefined) {
      delete process.env.JANT_API_TOKEN;
    } else {
      process.env.JANT_API_TOKEN = originalEnv.JANT_API_TOKEN;
    }

    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads JANT_API_TOKEN and ignores legacy API_TOKEN", () => {
    expect(
      getCliApiToken({
        API_TOKEN: "jnt_legacy_token",
        JANT_API_TOKEN: "jnt_prefixed_token",
      }),
    ).toBe("jnt_prefixed_token");
    expect(getCliApiToken({ API_TOKEN: "jnt_legacy_token" })).toBeUndefined();
    expect(CLI_API_TOKEN_ENV_VAR).toBe("JANT_API_TOKEN");
  });

  it("uses JANT_API_TOKEN for remote site export requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "jant-site-export-token-"));
    tempDirs.push(root);

    const outputPath = join(root, "jant-site-export.zip");
    delete process.env.API_TOKEN;
    process.env.JANT_API_TOKEN = "jnt_prefixed_token";

    const fetchMock = vi.fn(async () => {
      return new Response(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runSiteExport([
      "--url",
      "https://example.com",
      "--output",
      outputPath,
      "--no-pull-media",
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api/export/hugo",
      expect.objectContaining({
        headers: { Authorization: "Bearer jnt_prefixed_token" },
        method: "POST",
      }),
    );

    const output = await readFile(outputPath);
    expect(output).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it("accepts JANT_API_TOKEN for remote site import", async () => {
    delete process.env.API_TOKEN;
    process.env.JANT_API_TOKEN = "jnt_prefixed_token";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code ?? 0}`);
    });

    await expect(
      runImportSite([
        "--url",
        "https://example.com",
        "--path",
        "/definitely-missing-jant-import-source",
      ]),
    ).rejects.toThrow("process.exit:1");

    expect(errorSpy).toHaveBeenCalledWith(
      "Path not found: /definitely-missing-jant-import-source",
    );
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("site import requires JANT_API_TOKEN or --token"),
    );
  });

  it("rejects legacy API_TOKEN for remote site import", async () => {
    process.env.API_TOKEN = "jnt_legacy_token";
    delete process.env.JANT_API_TOKEN;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code ?? 0}`);
    });

    await expect(
      runImportSite([
        "--url",
        "https://example.com",
        "--path",
        "/definitely-missing-jant-import-source",
      ]),
    ).rejects.toThrow("process.exit:1");

    expect(errorSpy).toHaveBeenCalledWith(
      "Error: site import requires JANT_API_TOKEN or --token (unless using --dry-run)",
    );
  });
});
