/**
 * Spawns the real Hugo binary against a freshly generated export tree to
 * prove the bundled theme actually builds a coherent site. The test skips
 * gracefully when `hugo` is not on PATH so local dev without Hugo installed
 * still keeps the suite green; CI installs the pinned version via mise.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExportService } from "../services/export.js";
import {
  makeCollection,
  makeMedia,
  makePost,
  makeSiteConfig,
} from "./helpers/export-fixtures.js";

type ServicesArg = Parameters<typeof createExportService>[0];

function hugoAvailable(): boolean {
  const result = spawnSync("hugo", ["version"], {
    stdio: "ignore",
    shell: false,
  });
  return result.status === 0;
}

function runHugo(
  sourceDir: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "hugo",
      ["--source", sourceDir, "--minify", "--destination", "public"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (buf) => {
      stdout += buf.toString();
    });
    child.stderr?.on("data", (buf) => {
      stderr += buf.toString();
    });
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function fileExists(path: string): Promise<boolean> {
  const s = await stat(path).catch(() => null);
  return s?.isFile() ?? false;
}

function buildFixtureServices(): ServicesArg {
  const root = makePost({
    id: "pst_root",
    slug: "hello-world",
    title: "Hello World",
    threadId: "pst_root",
  });
  const reply = makePost({
    id: "pst_reply",
    slug: "hello-reply",
    title: "Follow-up",
    replyToId: "pst_root",
    threadId: "pst_root",
    createdAt: 1773020000,
    publishedAt: 1773020000,
    featuredAt: 1773030000,
  });
  const collection = makeCollection({ id: "col-1", slug: "ideas" });
  const media = makeMedia({ id: "med_hero", filename: "hero.webp" });
  return {
    posts: { list: async () => [root, reply] },
    paths: {
      getPostSlugMap: async () =>
        new Map([
          ["pst_root", "hello-world"],
          ["pst_reply", "hello-reply"],
        ]),
      getPostAliases: async () => new Map(),
      getCollectionSlugMap: async () => new Map([["col-1", "ideas"]]),
    },
    collections: {
      list: async () => [collection],
      listDirectoryData: async () => ({
        collections: [],
        items: [
          {
            id: "dir-col-1",
            type: "collection" as const,
            collection: {
              ...collection,
              threadCount: 1,
              recentActivityAt: collection.updatedAt,
            },
          },
        ],
        directoryItems: [],
      }),
      getCollectionsByPostIds: async () =>
        new Map([["pst_root", [collection]]]),
      getCollectionEntriesByThreadIds: async () =>
        new Map([
          [
            "pst_root",
            [
              {
                collectionId: "col-1",
                createdAt: 1773020000,
                position: 0,
                pinnedAt: null,
              },
            ],
          ],
        ]),
    },
    media: {
      getByPostIds: async () => new Map([["pst_root", [media]]]),
    },
  } as unknown as ServicesArg;
}

describe("Hugo smoke build", () => {
  let tempDir: string;
  let hugoOk = false;

  beforeAll(async () => {
    hugoOk = hugoAvailable();
    tempDir = await mkdtemp(join(tmpdir(), "jant-hugo-build-"));
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("hugo builds the generated site tree without ERROR or FATAL", async () => {
    if (!hugoOk) {
      // Hugo required in CI; skip locally if unavailable.
      console.log("hugo binary not found on PATH — skipping hugo build test");
      return;
    }

    const services = buildFixtureServices();
    const exportService = createExportService(services, makeSiteConfig());
    const files = await exportService.generateHugoFiles();

    for (const file of files) {
      const target = join(tempDir, file.path);
      await mkdir(dirname(target), { recursive: true });
      const data =
        typeof file.content === "string"
          ? new TextEncoder().encode(file.content)
          : file.content;
      await writeFile(target, data);
    }
    // Emit real bytes for the sibling page resource so Hugo's resource
    // processing doesn't warn.
    await writeFile(
      join(tempDir, "content/hello-world/med_hero.webp"),
      "PHOTO",
    );

    const { code, stdout, stderr } = await runHugo(tempDir);
    if (code !== 0) {
      console.error("hugo stdout:", stdout);
      console.error("hugo stderr:", stderr);
    }
    expect(code).toBe(0);
    expect(stderr).not.toMatch(/\bERROR\b/);
    expect(stderr).not.toMatch(/\bFATAL\b/);

    // Expected generated URLs.
    for (const rel of [
      "public/index.html",
      "public/featured/index.html",
      "public/featured/index.xml",
      "public/archive/index.html",
      "public/collections/index.html",
      "public/ideas/index.html",
      "public/ideas/index.xml",
      "public/hello-world/index.html",
      // Alias page for the reply slug (root aliases include /hello-reply/).
      "public/hello-reply/index.html",
      // The feed redirects are useless unless Hugo copies them to the root of
      // the published directory, where Cloudflare Pages and Netlify look.
      "public/_redirects",
    ]) {
      expect(await fileExists(join(tempDir, rel)), `missing ${rel}`).toBe(true);
    }

    const collectionHtml = await readFile(
      join(tempDir, "public/ideas/index.html"),
      "utf-8",
    );
    expect(collectionHtml).toContain("Hello World");
    expect(collectionHtml).toContain("Follow-up");
    expect(collectionHtml).toMatch(
      /class="thread thread-full thread-has-replies"/,
    );

    const collectionFeed = await readFile(
      join(tempDir, "public/ideas/index.xml"),
      "utf-8",
    );
    expect(collectionFeed).toContain("Hello World");
    expect(collectionFeed).toContain("Follow-up");
    expect(collectionFeed.match(/<entry>/g)).toHaveLength(1);

    const featuredHtml = await readFile(
      join(tempDir, "public/featured/index.html"),
      "utf-8",
    );
    expect(featuredHtml).toContain("Hello World");
    expect(featuredHtml).toContain("Follow-up");
    expect(featuredHtml).toContain("thread-item-featured");

    const featuredFeed = await readFile(
      join(tempDir, "public/featured/index.xml"),
      "utf-8",
    );
    expect(featuredFeed).toContain("Hello World");
    expect(featuredFeed).toContain("Follow-up");
    expect(featuredFeed.match(/<entry>/g)).toHaveLength(1);
  }, 60_000);
});
