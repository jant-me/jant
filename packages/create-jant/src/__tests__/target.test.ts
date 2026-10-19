import { execSync } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describeConflicts,
  findConflicts,
  isInsideGitWorkTree,
  resolveTarget,
  toProjectName,
} from "../target.js";

describe("resolveTarget", () => {
  const cwd = path.resolve("/home/me/sites");

  it("takes . as the current directory, with nothing to cd into", () => {
    expect(resolveTarget(".", cwd)).toEqual({ dir: cwd, cdPath: null });
    expect(resolveTarget("./", cwd)).toEqual({ dir: cwd, cdPath: null });
  });

  it("resolves a name or a relative path from the current directory", () => {
    expect(resolveTarget("my-site", cwd)).toEqual({
      dir: path.join(cwd, "my-site"),
      cdPath: "my-site",
    });
    expect(resolveTarget("../blogs/blog/", cwd)).toEqual({
      dir: path.resolve(cwd, "../blogs/blog"),
      cdPath: path.join("..", "blogs", "blog"),
    });
  });

  it("keeps an absolute path absolute", () => {
    const dir = path.resolve("/srv/blog");
    expect(resolveTarget(dir, cwd)).toEqual({ dir, cdPath: dir });
  });

  it("quotes a path the shell would split", () => {
    expect(resolveTarget("My Blog", cwd).cdPath).toBe('"My Blog"');
    expect(resolveTarget("博客", cwd).cdPath).toBe('"博客"');
  });
});

describe("toProjectName", () => {
  it("keeps lowercase letters, digits, and single hyphens", () => {
    expect(toProjectName("my-site")).toBe("my-site");
    expect(toProjectName("jant-0.12")).toBe("jant-0-12");
    expect(toProjectName("My Blog")).toBe("my-blog");
    expect(toProjectName("--a__b--")).toBe("a-b");
    expect(toProjectName("2026 博客")).toBe("2026");
  });

  it("returns nothing when no letter or digit is left", () => {
    expect(toProjectName("博客")).toBe("");
    expect(toProjectName("___")).toBe("");
    expect(toProjectName("")).toBe("");
  });
});

describe("findConflicts", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "create-jant-target-"));
  });

  afterEach(() => {
    fs.removeSync(dir);
  });

  it("finds none in a directory that doesn't exist yet or is empty", () => {
    expect(findConflicts(path.join(dir, "missing"))).toEqual([]);
    expect(findConflicts(dir)).toEqual([]);
  });

  it("ignores version control, editor, and OS files and a license", () => {
    for (const entry of [".git", ".hg", ".idea", ".vscode"]) {
      fs.mkdirSync(path.join(dir, entry));
    }
    for (const entry of [".DS_Store", ".gitattributes", "LICENSE"]) {
      fs.writeFileSync(path.join(dir, entry), "");
    }
    expect(findConflicts(dir)).toEqual([]);
  });

  it("lists every other entry, sorted", () => {
    fs.mkdirSync(path.join(dir, ".git"));
    fs.mkdirSync(path.join(dir, ".github"));
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "README.md"), "");
    expect(findConflicts(dir)).toEqual([
      ".github",
      "README.md",
      "package.json",
    ]);
  });

  it("reports a file in the directory's place as the conflict", () => {
    const file = path.join(dir, "notes.txt");
    fs.writeFileSync(file, "");
    expect(findConflicts(file)).toEqual(["notes.txt"]);
  });
});

describe("describeConflicts", () => {
  const cwd = path.resolve("/home/me");

  it("names the current directory", () => {
    expect(describeConflicts(resolveTarget(".", cwd), ["package.json"])).toBe(
      "The current directory has files that could conflict: package.json. Choose another directory, or move these files first.",
    );
  });

  it("names the directory as typed and counts what it doesn't list", () => {
    expect(
      describeConflicts(resolveTarget("My Blog", cwd), [
        "README.md",
        "docs",
        "index.js",
        "package.json",
        "wrangler.toml",
      ]),
    ).toBe(
      '"My Blog" has files that could conflict: README.md, docs, index.js, and 2 more. Choose another directory, or move these files first.',
    );
  });
});

describe("isInsideGitWorkTree", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "create-jant-git-"));
  });

  afterEach(() => {
    fs.removeSync(dir);
  });

  it("is false outside a repository", () => {
    expect(isInsideGitWorkTree(dir)).toBe(false);
  });

  it("is true in a repository and in its subdirectories", () => {
    execSync("git init --quiet", { cwd: dir });
    const site = path.join(dir, "site");
    fs.mkdirSync(site);
    expect(isInsideGitWorkTree(dir)).toBe(true);
    expect(isInsideGitWorkTree(site)).toBe(true);
  });
});
