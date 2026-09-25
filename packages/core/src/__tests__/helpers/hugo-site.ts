/**
 * Build an export with the real Hugo binary and read lists back out of it.
 *
 * For the tests that hold an exported page to the list Jant shows: the theme
 * reimplements membership and order in Go templates, and only a real build
 * shows what a reader of the static site gets.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isStoredExportFile, type ExportFile } from "../../services/export.js";

/** Whether `hugo` is on PATH. Tests that need it skip without it. */
export const hugoAvailable =
  spawnSync("hugo", ["version"], { stdio: "ignore" }).status === 0;

/**
 * Write an export to a temporary directory and build it, unminified so the
 * markup reads back predictably.
 *
 * @param files - What `generateHugoFiles` returned; stored media is skipped
 * @returns The site directory; the build is in its `public/`
 * @throws {Error} With Hugo's output when the build fails
 * @example
 * const siteDir = await buildHugoSite(await exporter.generateHugoFiles());
 */
export async function buildHugoSite(files: ExportFile[]): Promise<string> {
  const siteDir = await mkdtemp(join(tmpdir(), "jant-hugo-site-"));
  for (const file of files) {
    if (isStoredExportFile(file)) continue;
    const target = join(siteDir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }

  const { code, log } = await new Promise<{ code: number; log: string }>(
    (resolve) => {
      const child = spawn("hugo", ["--source", siteDir], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout?.on("data", (chunk) => (output += chunk.toString()));
      child.stderr?.on("data", (chunk) => (output += chunk.toString()));
      child.on("close", (exitCode) =>
        resolve({ code: exitCode ?? -1, log: output }),
      );
    },
  );
  if (code !== 0) throw new Error(`Hugo build failed:\n${log}`);
  return siteDir;
}

/**
 * The Thread roots a collection-style page lists, in order, across all of
 * its pages.
 *
 * @param siteDir - From {@link buildHugoSite}
 * @param section - The section's slug
 * @returns Root slugs, first page first
 * @example
 * await readThreadSlugs(siteDir, "ideas"); // ["newest-thread", ...]
 */
export async function readThreadSlugs(
  siteDir: string,
  section: string,
): Promise<string[]> {
  const slugs: string[] = [];
  for (let page = 1; ; page++) {
    const path =
      page === 1
        ? join(siteDir, "public", section, "index.html")
        : join(siteDir, "public", section, "page", String(page), "index.html");
    const html = await readFile(path, "utf8").catch(() => null);
    if (html === null) return slugs;
    for (const match of html.matchAll(
      /<div class="thread thread-full[^"]*" data-slug="([^"]+)"/g,
    )) {
      slugs.push(match[1] as string);
    }
  }
}

/**
 * The posts a section's Atom feed carries, in order, by slug.
 *
 * @param siteDir - From {@link buildHugoSite}
 * @param section - The section's slug
 * @param siteUrl - The export's site URL, which permalinks start with
 * @returns One slug per entry
 * @example
 * await readFeedSlugs(siteDir, "ideas", "https://example.com");
 */
export async function readFeedSlugs(
  siteDir: string,
  section: string,
  siteUrl: string,
): Promise<string[]> {
  const xml = await readFile(
    join(siteDir, "public", section, "index.xml"),
    "utf8",
  );
  const permalink = new RegExp(
    `href="${siteUrl.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/([^/"]+)/"`,
  );
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(
    (entry) => entry[1]?.match(permalink)?.[1] ?? "",
  );
}
