/**
 * ZIP archives that stream to and from disk.
 *
 * Site exports and snapshots carry a site's media, and a real site's media
 * runs to gigabytes. Building the archive in memory ran into Node's 2 GiB
 * ceiling on one write or read, held three times the media in RAM, and
 * fflate's writer has no ZIP64, so an archive past 4 GiB could not be
 * written at all. yazl writes ZIP64 on its own when an archive needs it, and
 * yauzl reads one entry at a time.
 */

import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import yazl from "yazl";

/**
 * Extensions stored as-is: they are compressed formats already, and deflating
 * a gigabyte of video costs minutes to save nothing.
 */
const STORED_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".heic",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".opus",
  ".pdf",
  ".png",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

async function listFiles(rootDir) {
  const files = [];
  for (const entry of await readdir(rootDir, { withFileTypes: true })) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Write every file under a directory to a ZIP file.
 *
 * The archive goes to a temporary name next to the output and is renamed into
 * place once complete, so a failure never leaves a truncated or empty archive
 * where the reader expects a finished one.
 *
 * @param {string} sourceDir - Directory to archive
 * @param {string} zipPath - Output archive path
 * @returns {Promise<{ files: number }>} How many files went in
 * @example
 * await writeDirectoryToZip("./jant-site", "./jant-site-export.zip");
 */
export async function writeDirectoryToZip(sourceDir, zipPath) {
  const files = (await listFiles(sourceDir)).sort();
  const zipFile = new yazl.ZipFile();
  // yazl reports a file it can't read on the ZipFile, not on its output
  // stream, which would otherwise wait for the rest of the archive forever.
  const failed = new Promise((_resolve, reject) => {
    zipFile.on("error", (error) => {
      zipFile.outputStream.destroy(error);
      reject(error);
    });
  });

  for (const fullPath of files) {
    const entryName = relative(sourceDir, fullPath).split(sep).join("/");
    zipFile.addFile(fullPath, entryName, {
      compress: !STORED_EXTENSIONS.has(extname(entryName).toLowerCase()),
    });
  }
  zipFile.end();

  await mkdir(dirname(zipPath), { recursive: true });
  const partialPath = `${zipPath}.partial`;
  const written = pipeline(
    zipFile.outputStream,
    createWriteStream(partialPath),
  );
  try {
    await Promise.race([written, failed]);
    await rename(partialPath, zipPath);
  } catch (error) {
    await written.catch(() => {});
    await rm(partialPath, { force: true });
    throw error;
  }

  return { files: files.length };
}

function openZip(open) {
  return new Promise((resolvePromise, reject) => {
    open((error, zipFile) => (error ? reject(error) : resolvePromise(zipFile)));
  });
}

async function extractOpenZip(zipFile, targetDir) {
  const root = resolve(targetDir);
  let files = 0;

  await new Promise((resolvePromise, reject) => {
    const fail = (error) => {
      zipFile.close();
      reject(error);
    };

    zipFile.on("error", fail);
    zipFile.on("end", () => resolvePromise());
    zipFile.on("entry", (entry) => {
      // yauzl already refuses absolute and `..` names; this holds the line
      // whatever the library's defaults become.
      const outputPath = resolve(root, entry.fileName);
      if (outputPath !== root && !outputPath.startsWith(`${root}${sep}`)) {
        fail(
          new Error(
            `Refusing ZIP entry outside the archive: ${entry.fileName}`,
          ),
        );
        return;
      }

      if (entry.fileName.endsWith("/")) {
        mkdir(outputPath, { recursive: true }).then(
          () => zipFile.readEntry(),
          fail,
        );
        return;
      }

      zipFile.openReadStream(entry, (error, readStream) => {
        if (error) {
          fail(error);
          return;
        }
        mkdir(dirname(outputPath), { recursive: true })
          .then(() => pipeline(readStream, createWriteStream(outputPath)))
          .then(() => {
            files += 1;
            zipFile.readEntry();
          }, fail);
      });
    });
    zipFile.readEntry();
  });

  return { files };
}

/**
 * Extract a ZIP file into a directory, one entry at a time.
 *
 * @param {string} zipPath - Archive to read; ZIP64 is fine
 * @param {string} targetDir - Directory to write into
 * @returns {Promise<{ files: number }>} How many files came out
 * @throws {Error} When an entry names a path outside `targetDir`
 * @example
 * await extractZipFile("./jant-site-export.zip", tempDir);
 */
export async function extractZipFile(zipPath, targetDir) {
  const zipFile = await openZip((callback) =>
    yauzl.open(zipPath, { lazyEntries: true }, callback),
  );
  return extractOpenZip(zipFile, targetDir);
}
