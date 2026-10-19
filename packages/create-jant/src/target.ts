/**
 * Where a new project goes: the directory a scaffold writes into, the name the
 * project takes from it, and what the directory already holds.
 */
import { execSync } from "child_process";
import fs from "fs-extra";
import path from "path";

/** Directory a scaffold creates when none is given, and the fallback name. */
export const DEFAULT_DIRECTORY = "my-jant-site";

/**
 * Entries a directory can already hold without blocking a scaffold into it:
 * version control, editor and OS files, and a license. The template writes
 * none of them.
 */
const HARMLESS_ENTRIES = new Set([
  ".DS_Store",
  ".git",
  ".gitattributes",
  ".hg",
  ".idea",
  ".vscode",
  "LICENSE",
  "Thumbs.db",
]);

/** How many conflicting entries a message names before it counts the rest. */
const NAMED_CONFLICTS = 3;

export interface Target {
  /** Absolute path of the project directory */
  dir: string;
  /**
   * Path to `cd` into from the directory create-jant runs in, quoted when the
   * shell needs it, or null when the project is that directory
   */
  cdPath: string | null;
}

/**
 * Resolve the directory a scaffold writes into.
 *
 * @param input - directory as given on the command line or at the prompt
 * @param cwd - directory create-jant runs in
 * @returns the absolute directory, and the path to `cd` into from `cwd`:
 *   relative, or absolute when `input` was
 * @example
 * resolveTarget(".", "/home/me/blog"); // { dir: "/home/me/blog", cdPath: null }
 * resolveTarget("My Blog", "/home/me"); // { dir: "/home/me/My Blog", cdPath: '"My Blog"' }
 */
export function resolveTarget(input: string, cwd: string): Target {
  const dir = path.resolve(cwd, input);
  const relative = path.relative(cwd, dir);
  if (relative === "") {
    return { dir, cdPath: null };
  }
  const shown = path.isAbsolute(input) ? dir : relative;
  return { dir, cdPath: /^[\w./-]+$/.test(shown) ? shown : `"${shown}"` };
}

/**
 * Turn a directory name into a project name: lowercase letters, digits, and
 * single hyphens, which Cloudflare accepts for the Worker, the D1 database,
 * and the R2 bucket named after it.
 *
 * @param value - directory name, or a name typed at the prompt
 * @returns the project name, or "" when `value` has no letter or digit to keep
 * @example
 * toProjectName("jant-0.12"); // "jant-0-12"
 * toProjectName("My Blog"); // "my-blog"
 * toProjectName("博客"); // ""
 */
export function toProjectName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * List the entries of a directory a scaffold could overwrite: all of them but
 * version control, editor, and OS files.
 *
 * @param dir - absolute path of the project directory
 * @returns the entries, sorted; none when the directory doesn't exist yet, and
 *   the path's own name when it is a file
 * @example
 * findConflicts("/home/me/blog"); // [".github", "package.json"]
 */
export function findConflicts(dir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code === "ENOENT") return [];
    if (code === "ENOTDIR") return [path.basename(dir)];
    throw error;
  }
  return entries.filter((entry) => !HARMLESS_ENTRIES.has(entry)).sort();
}

/**
 * Say which entries keep a scaffold out of a directory.
 *
 * @param target - the project directory
 * @param conflicts - its entries from {@link findConflicts}, at least one
 * @returns one sentence naming the directory and the first entries
 * @example
 * describeConflicts({ dir: "/home/me/blog", cdPath: null }, ["package.json"]);
 * // "The current directory has files that could conflict: package.json. Choose another directory, or move these files first."
 */
export function describeConflicts(target: Target, conflicts: string[]): string {
  const directory = target.cdPath ?? "The current directory";
  const named = conflicts.slice(0, NAMED_CONFLICTS);
  const rest = conflicts.length - named.length;
  const list =
    rest > 0 ? `${named.join(", ")}, and ${rest} more` : named.join(", ");
  return `${directory} has files that could conflict: ${list}. Choose another directory, or move these files first.`;
}

/**
 * Whether a directory is inside a git work tree, its own or a parent
 * directory's.
 *
 * @param dir - an existing directory
 * @returns true inside a work tree; false outside one, or when git is missing
 * @example
 * isInsideGitWorkTree("/home/me/dotfiles/blog"); // true
 */
export function isInsideGitWorkTree(dir: string): boolean {
  try {
    const output = execSync("git rev-parse --is-inside-work-tree", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim() === "true";
  } catch {
    return false;
  }
}
