import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("jant deploy", () => {
  const tempDirs: string[] = [];
  const originalCwd = process.cwd();

  afterEach(async () => {
    process.chdir(originalCwd);
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("reuses the configured assets directory for root-path deploys", async () => {
    const root = await mkdtemp(join(tmpdir(), "jant-deploy-root-"));
    tempDirs.push(root);

    await writeFile(
      join(root, "wrangler.toml"),
      `
[assets]
directory = "./static-assets"
      `.trim(),
    );

    process.chdir(root);

    const runMigrate = vi.fn(async () => {});
    const preparePublicAssets = vi.fn(async () => ({
      outputDir: join(root, "dist/public"),
    }));
    const spawnSync = vi.fn(() => ({ status: 0 }));

    vi.doMock("../../../bin/commands/migrate.js", () => ({
      run: runMigrate,
    }));
    vi.doMock("../../../bin/lib/public-assets.js", () => ({
      DEFAULT_PUBLISH_DIR: "dist/public",
      preparePublicAssets,
      resolvePackageClientRoot: vi.fn(() => join(root, "fallback-client")),
    }));
    vi.doMock("node:child_process", () => ({ spawnSync }));

    const { run } = await import("../../../bin/commands/deploy.js");
    await run([]);

    expect(runMigrate).toHaveBeenCalledWith([
      "--remote",
      "--database",
      "DB",
      "--config",
      "wrangler.toml",
    ]);
    expect(preparePublicAssets).not.toHaveBeenCalled();
    const [wranglerBin, wranglerArgs, spawnOptions] = spawnSync.mock.calls[0];
    expect(wranglerBin).toMatch(/^wrangler/);
    expect(wranglerArgs).toEqual([
      "deploy",
      "--assets",
      expect.stringMatching(/\/static-assets$/),
      "--config",
      "wrangler.toml",
    ]);
    expect(spawnOptions).toEqual(expect.objectContaining({ stdio: "inherit" }));
  });

  it("prepares a publish directory for subpath deploys and forwards wrangler args", async () => {
    const root = await mkdtemp(join(tmpdir(), "jant-deploy-prefix-"));
    tempDirs.push(root);

    await writeFile(
      join(root, "wrangler.toml"),
      `
[assets]
directory = "./static-assets"

[vars]
SITE_PATH_PREFIX = "/blog"
      `.trim(),
    );

    process.chdir(root);

    const preparePublicAssets = vi.fn(async () => ({
      outputDir: join(root, "dist/public"),
    }));
    const spawnSync = vi.fn(() => ({ status: 0 }));

    vi.doMock("../../../bin/commands/migrate.js", () => ({
      run: vi.fn(async () => {}),
    }));
    vi.doMock("../../../bin/lib/public-assets.js", () => ({
      DEFAULT_PUBLISH_DIR: "dist/public",
      preparePublicAssets,
      resolvePackageClientRoot: vi.fn(() => join(root, "fallback-client")),
    }));
    vi.doMock("node:child_process", () => ({ spawnSync }));

    const { run } = await import("../../../bin/commands/deploy.js");
    await run(["--skip-migrate", "--", "--dry-run"]);

    expect(preparePublicAssets).toHaveBeenCalledWith({
      outputDir: "dist/public",
      sitePathPrefix: "/blog",
    });
    const [wranglerBin, wranglerArgs, spawnOptions] = spawnSync.mock.calls[0];
    expect(wranglerBin).toMatch(/^wrangler/);
    expect(wranglerArgs).toEqual([
      "deploy",
      "--assets",
      expect.stringMatching(/\/dist\/public$/),
      "--config",
      "wrangler.toml",
      "--dry-run",
    ]);
    expect(spawnOptions).toEqual(expect.objectContaining({ stdio: "inherit" }));
  });

  async function deployNewProject(status: number) {
    const root = await mkdtemp(join(tmpdir(), "jant-deploy-first-"));
    tempDirs.push(root);
    await writeFile(join(root, "wrangler.toml"), "");
    process.chdir(root);

    const setup = {
      secretsFile: join(root, "secrets.json"),
      restore: vi.fn(),
      cleanup: vi.fn(),
    };
    const spawnSync = vi.fn(() => ({ status }));

    vi.doMock("../../../bin/lib/cloudflare-setup.js", () => ({
      BEFORE_GOING_LIVE_URL:
        "https://jant.me/docs/deployment#before-going-live",
      needsFirstDeploySetup: vi.fn(() => true),
      runFirstDeploySetup: vi.fn(async () => setup),
    }));
    vi.doMock("../../../bin/commands/migrate.js", () => ({
      run: vi.fn(async () => {}),
    }));
    vi.doMock("../../../bin/lib/public-assets.js", () => ({
      DEFAULT_PUBLISH_DIR: "dist/public",
      preparePublicAssets: vi.fn(),
      resolvePackageClientRoot: vi.fn(() => join(root, "client")),
    }));
    vi.doMock("node:child_process", () => ({ spawnSync }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { run } = await import("../../../bin/commands/deploy.js");
    return { run: () => run([]), setup, spawnSync };
  }

  it("hands a new project's first deploy its generated secrets", async () => {
    const { run, setup, spawnSync } = await deployNewProject(0);
    await run();

    const [, wranglerArgs] = spawnSync.mock.calls[0];
    expect(wranglerArgs).toEqual(
      expect.arrayContaining(["--secrets-file", setup.secretsFile]),
    );
    expect(setup.restore).not.toHaveBeenCalled();
    expect(setup.cleanup).toHaveBeenCalledOnce();
  });

  it("puts wrangler.toml back when a first deploy fails", async () => {
    const { run, setup } = await deployNewProject(1);
    await expect(run()).rejects.toThrow("wrangler deploy failed");

    expect(setup.restore).toHaveBeenCalledOnce();
    expect(setup.cleanup).toHaveBeenCalledOnce();
  });
});
