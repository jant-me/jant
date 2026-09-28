/**
 * Every place that picks a Node or pnpm version picks the same one.
 *
 * mise installs the toolchain for local work and CI checks, `packageManager`
 * drives pnpm in the deploy workflow and the Docker build, and the Dockerfile
 * and deploy workflow name their Node image and version separately. They had
 * drifted: mise ran pnpm 10.28.2 against a lockfile written by 10.33.0, and
 * `node = "lts"` would have moved local work to the next major on its own
 * while the image stayed on 24.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function capture(text: string, pattern: RegExp, label: string): string {
  const value = pattern.exec(text)?.[1];
  if (!value) throw new Error(`No ${label} found`);
  return value;
}

describe("toolchain versions", () => {
  const mise = read("mise.toml");
  const rootPackage = JSON.parse(read("package.json")) as {
    packageManager: string;
    engines: { node: string };
  };

  it("run one pnpm version", () => {
    expect(capture(mise, /^pnpm = "([^"]+)"$/m, "mise pnpm")).toBe(
      rootPackage.packageManager.replace(/^pnpm@/, ""),
    );
  });

  it("run one Node major", () => {
    const major = capture(mise, /^node = "(\d+)"$/m, "mise node major");

    expect(rootPackage.engines.node).toBe(`>=${major}.0.0`);
    for (const [path, pattern] of [
      ["Dockerfile", /^FROM node:(\d+)-/gm],
      [".github/workflows/deploy.yml", /^ {8}default: "(\d+)"$/gm],
    ] as const) {
      const found = [...read(path).matchAll(pattern)].map((match) => match[1]);
      expect(found.length, path).toBeGreaterThan(0);
      expect(new Set(found), path).toEqual(new Set([major]));
    }
  });
});
