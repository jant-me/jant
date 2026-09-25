/**
 * Streaming ZIP helpers used by `site export`, `site import`,
 * `site pull-media`, and `site snapshot`.
 */

import { createWriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { zipSync } from "fflate";
import yazl from "yazl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractZipBuffer,
  extractZipFile,
  writeDirectoryToZip,
} from "../../bin/lib/zip-archive.js";

describe("zip-archive", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "jant-zip-"));
  });

  afterEach(async () => {
    await chmod(join(tempDir, "source", "locked.md"), 0o644).catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes a directory and reads it back byte for byte", async () => {
    const source = join(tempDir, "source");
    const image = new Uint8Array(4096).map((_, index) => index % 251);
    await mkdir(join(source, "content", "hello"), { recursive: true });
    await mkdir(join(source, "static", "media"), { recursive: true });
    await writeFile(
      join(source, "hugo.toml"),
      'baseURL = "https://a.example/"',
    );
    await writeFile(
      join(source, "content", "hello", "_index.md"),
      "---\n---\n你好",
    );
    await writeFile(join(source, "static", "media", "a.jpg"), image);

    const zipPath = join(tempDir, "out", "site.zip");
    expect(await writeDirectoryToZip(source, zipPath)).toEqual({ files: 3 });

    const target = join(tempDir, "target");
    expect(await extractZipFile(zipPath, target)).toEqual({ files: 3 });
    expect(
      await readFile(join(target, "content", "hello", "_index.md"), "utf8"),
    ).toBe("---\n---\n你好");
    expect(
      new Uint8Array(await readFile(join(target, "static", "media", "a.jpg"))),
    ).toEqual(image);
  });

  it("reads a ZIP64 archive", async () => {
    const zipFile = new yazl.ZipFile();
    zipFile.addBuffer(Buffer.from("big enough to need ZIP64"), "data/a.txt");
    zipFile.end({ forceZip64Format: true });
    const zipPath = join(tempDir, "zip64.zip");
    await pipeline(zipFile.outputStream, createWriteStream(zipPath));

    await extractZipFile(zipPath, join(tempDir, "target"));

    expect(
      await readFile(join(tempDir, "target", "data", "a.txt"), "utf8"),
    ).toBe("big enough to need ZIP64");
  });

  it("refuses an entry that climbs out of the target directory", async () => {
    const bytes = zipSync({ "../escaped.txt": new TextEncoder().encode("x") });

    await expect(
      extractZipBuffer(bytes, join(tempDir, "target")),
    ).rejects.toThrow();
    await expect(stat(join(tempDir, "escaped.txt"))).rejects.toThrow();
  });

  it("leaves no archive behind when writing fails", async () => {
    if (process.getuid?.() === 0) return; // root reads a mode-000 file anyway
    const source = join(tempDir, "source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "locked.md"), "secret");
    await chmod(join(source, "locked.md"), 0o000);

    const zipPath = join(tempDir, "site.zip");
    await expect(writeDirectoryToZip(source, zipPath)).rejects.toThrow();
    await expect(stat(zipPath)).rejects.toThrow();
    await expect(stat(`${zipPath}.partial`)).rejects.toThrow();
  });
});
