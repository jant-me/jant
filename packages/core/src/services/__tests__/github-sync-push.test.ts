/**
 * Unit tests for the deletion-detection half of `pushFullSync`.
 *
 * The full `pushFullSync` wires services, an export pipeline, and the
 * GitHub client together — covered by manual verification and the
 * broader sync integration tests. What matters behaviourally is the
 * two helpers that decide "is this path ours?" and "which files on
 * the remote should be null-ed out?". Those are exported from the
 * service module and tested here in isolation.
 */

import { describe, expect, it } from "vitest";
import type { GitHubTreeItem } from "../../lib/github-api.js";
import type { ExportFile } from "../export.js";
import {
  computeManagedDeletions,
  isManagedPath,
  pathMatchesManagedGlob,
  selectFilesToWrite,
} from "../github-sync.js";

describe("pathMatchesManagedGlob", () => {
  it("matches a directory prefix via the /** suffix", () => {
    expect(pathMatchesManagedGlob("content/posts/foo.md", "content/**")).toBe(
      true,
    );
    expect(pathMatchesManagedGlob("content", "content/**")).toBe(true);
    expect(pathMatchesManagedGlob("contentious", "content/**")).toBe(false);
  });

  it("matches an exact path", () => {
    expect(pathMatchesManagedGlob("hugo.toml", "hugo.toml")).toBe(true);
    expect(pathMatchesManagedGlob("hugo.toml.bak", "hugo.toml")).toBe(false);
    expect(pathMatchesManagedGlob("data/jant.toml", "data/jant.toml")).toBe(
      true,
    );
    expect(pathMatchesManagedGlob("data/other.toml", "data/jant.toml")).toBe(
      false,
    );
  });
});

describe("isManagedPath", () => {
  it.each([
    "content/posts/foo.md",
    "content/_index.md",
    "themes/jant/layouts/index.html",
    "themes/jant/static/style.css",
    "data/jant.toml",
    "hugo.toml",
    ".gitignore",
    "README.md",
    ".jant-sync",
  ])("treats %s as managed", (path) => {
    expect(isManagedPath(path)).toBe(true);
  });

  it.each([
    "data/menu.toml",
    "data/authors.toml",
    ".github/workflows/deploy.yml",
    "static/custom-asset.png",
    "layouts/my-override.html",
    "netlify.toml",
    "README.txt",
  ])("treats %s as user-owned", (path) => {
    expect(isManagedPath(path)).toBe(false);
  });
});

describe("selectFilesToWrite", () => {
  const generated: ExportFile[] = [
    { path: "hugo.toml", content: 'baseURL = "/"' },
    { path: "content/hello/_index.md", content: "---\n---\n" },
    { path: "wrangler.jsonc", content: "{}", scaffoldOnce: true },
  ];

  it("writes scaffolding the repository does not have yet", () => {
    const written = selectFilesToWrite(generated, new Set(["hugo.toml"]));

    expect(written.map((f) => f.path)).toEqual([
      "hugo.toml",
      "content/hello/_index.md",
      "wrangler.jsonc",
    ]);
  });

  it("leaves scaffolding alone once the repository has it", () => {
    // The Worker name in `wrangler.jsonc` is derived from the site host and
    // often has to be corrected to match the Worker serving the domain.
    // Rewriting it every push would revert that silently, and the symptom —
    // a deploy that succeeds against a Worker nobody is looking at — is
    // close to undiagnosable from the Jant side.
    const written = selectFilesToWrite(
      generated,
      new Set(["hugo.toml", "wrangler.jsonc"]),
    );

    expect(written.map((f) => f.path)).toEqual([
      "hugo.toml",
      "content/hello/_index.md",
    ]);
  });

  it("still rewrites ordinary files the repository already has", () => {
    const written = selectFilesToWrite(
      generated,
      new Set(["hugo.toml", "content/hello/_index.md"]),
    );

    expect(written.map((f) => f.path)).toContain("hugo.toml");
    expect(written.map((f) => f.path)).toContain("content/hello/_index.md");
  });
});

describe("computeManagedDeletions", () => {
  function blob(path: string): GitHubTreeItem {
    return { path, mode: "100644", type: "blob", sha: "sha-" + path };
  }

  it("returns an empty list when every managed file is also being written", () => {
    const headTree: GitHubTreeItem[] = [
      blob("content/posts/hello.md"),
      blob("hugo.toml"),
    ];
    const writtenPaths = new Set([
      "content/posts/hello.md",
      "hugo.toml",
      ".jant-sync",
    ]);
    expect(computeManagedDeletions(headTree, writtenPaths)).toEqual([]);
  });

  it("nulls out managed files that the current push no longer writes", () => {
    const headTree: GitHubTreeItem[] = [
      blob("content/posts/kept.md"),
      blob("content/posts/deleted.md"),
      blob("themes/jant/layouts/index.html"),
    ];
    // "content/posts/deleted.md" corresponds to a post the user just deleted;
    // only "kept.md" and the theme file are in this push.
    const writtenPaths = new Set([
      "content/posts/kept.md",
      "themes/jant/layouts/index.html",
      ".jant-sync",
    ]);

    const result = computeManagedDeletions(headTree, writtenPaths);
    expect(result).toEqual([
      {
        path: "content/posts/deleted.md",
        mode: "100644",
        type: "blob",
        sha: null,
      },
    ]);
  });

  it("never touches paths outside JANT_MANAGED_GLOBS", () => {
    const headTree: GitHubTreeItem[] = [
      blob(".github/workflows/deploy.yml"),
      blob("data/menu.toml"),
      blob("layouts/shortcodes/user-thing.html"),
      blob("docs/notes.md"),
    ];
    const writtenPaths = new Set<string>([".jant-sync"]);

    expect(computeManagedDeletions(headTree, writtenPaths)).toEqual([]);
  });

  it("preserves user files under data/ while still managing data/jant.toml", () => {
    const headTree: GitHubTreeItem[] = [
      blob("data/jant.toml"),
      blob("data/menu.toml"),
      blob("data/authors.toml"),
    ];
    // data/jant.toml is always regenerated; user-added data/* files are not.
    const writtenPaths = new Set(["data/jant.toml", ".jant-sync"]);

    const result = computeManagedDeletions(headTree, writtenPaths);
    // data/jant.toml is being written (not deleted). Other data/* files are
    // unmanaged and must stay put.
    expect(result).toEqual([]);
  });

  it("ignores non-blob tree entries (trees, commits, symlinks)", () => {
    const headTree: GitHubTreeItem[] = [
      { path: "content/posts", mode: "040000", type: "tree", sha: "t1" },
      { path: "content/posts/old.md", mode: "100644", type: "blob", sha: "b1" },
      // GitHub sometimes surfaces submodules or symlinks; deletion logic
      // must not attempt to null those out.
      { path: "vendor", mode: "160000", type: "commit", sha: "c1" },
    ];
    const writtenPaths = new Set<string>([".jant-sync"]);

    const result = computeManagedDeletions(headTree, writtenPaths);
    expect(result).toEqual([
      {
        path: "content/posts/old.md",
        mode: "100644",
        type: "blob",
        sha: null,
      },
    ]);
  });
});
