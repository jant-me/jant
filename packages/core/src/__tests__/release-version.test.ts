/**
 * A release never asks npm for a version it already holds.
 *
 * `@jant/core@1.0.0` was published by accident, so the first 1.x release is
 * 1.0.1. Changesets proposes 1.0.0 from a major changeset, and it rebuilds
 * the Release PR on every push to main, so the move to 1.0.1 has to happen
 * in `release-version` itself. Merged at 1.0.0, npm would skip `@jant/core`
 * but publish `create-jant@1.0.0`, whose projects install the accidental one.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  nextFreeVersion,
  skipTakenVersion,
} from "../../../../scripts/release/skip-taken-version.mjs";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

function releaseTree(version: string): string {
  const root = mkdtempSync(join(tmpdir(), "jant-release-version-"));
  dirs.push(root);
  for (const [dir, name] of [
    ["packages/core", "@jant/core"],
    ["packages/create-jant", "create-jant"],
  ] as const) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(
      join(root, dir, "package.json"),
      `{\n  "name": "${name}",\n  "version": "${version}",\n  "files": ["dist"]\n}\n`,
    );
    writeFileSync(
      join(root, dir, "CHANGELOG.md"),
      `# ${name}\n\n## ${version}\n\n### Major Changes\n\n## 0.11.0\n`,
    );
  }
  return root;
}

describe("release version", () => {
  it("steps past a version npm already holds", () => {
    expect(nextFreeVersion("1.0.0")).toBe("1.0.1");
    expect(nextFreeVersion("0.11.0")).toBe("0.11.0");
    expect(nextFreeVersion("1.0.0", new Set(["1.0.0", "1.0.1"]))).toBe("1.0.2");
  });

  it("moves both packages and their changelog headings to 1.0.1", () => {
    const root = releaseTree("1.0.0");

    expect(skipTakenVersion(root)).toBe("1.0.1");

    for (const dir of ["packages/core", "packages/create-jant"]) {
      const manifest = readFileSync(join(root, dir, "package.json"), "utf8");
      expect(JSON.parse(manifest).version).toBe("1.0.1");
      expect(manifest).toContain('"files": ["dist"]');
      const changelog = readFileSync(join(root, dir, "CHANGELOG.md"), "utf8");
      expect(changelog).toContain("\n## 1.0.1\n");
      expect(changelog).not.toContain("## 1.0.0");
      expect(changelog).toContain("\n## 0.11.0\n");
    }
  });

  it("leaves a free version alone", () => {
    const root = releaseTree("0.11.0");

    expect(skipTakenVersion(root)).toBeNull();
    expect(
      JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8"))
        .version,
    ).toBe("0.11.0");
  });
});
