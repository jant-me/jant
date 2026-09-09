/**
 * BaseCoat variant classes are self-contained, and this is what says so out
 * loud.
 *
 * AGENTS.md has carried the rule under Hard Constraints all along and it was
 * broken anyway, more than once, because nothing failed when it was: the markup
 * compiles, every other test passes, and the damage is visible only to an eye
 * looking at the right pixel.
 *
 * What `class="btn btn-outline"` does, exactly: both are single-class
 * selectors, so specificity ties and source order decides. `.btn-outline` is
 * declared later, so its `bg-background` wins the background — but it sets no
 * text colour, so `.btn`'s `text-primary-foreground` survives. A light label on
 * a light fill: the button reads as empty until `:hover`, where
 * `.btn-outline:hover` sets `text-accent-foreground` and the words appear. Each
 * pairing fails for its own reason, which is why the rule is "never combine"
 * rather than a list of bad pairs.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

/**
 * The BaseCoat families whose variants replace the base class rather than
 * modify it. Anything of the form `<base>-<x>` is one of `<base>`'s variants.
 */
const FAMILIES = ["btn", "badge", "alert"];

/** Class attributes as authored — JSX `className="…"` and Lit `class="…"` alike. */
const CLASS_ATTR = /\bclass(?:Name)?="([^"]*)"/g;

/**
 * Walk the source tree for authored markup.
 *
 * @param dir - Directory to descend into
 * @returns Absolute paths of every `.ts`/`.tsx` file outside tests
 */
function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      found.push(...collectSourceFiles(path));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Every class attribute in the repo's own markup, with the file it came from.
 *
 * A `class` built by interpolation is read for its literal words only. That is
 * the point rather than a limitation: the pairing this guards against is
 * written literally, and a regex should not try to evaluate a template.
 *
 * @returns One entry per class attribute found
 */
function readClassAttributes(): Array<{ file: string; classes: string[] }> {
  const found: Array<{ file: string; classes: string[] }> = [];

  for (const file of collectSourceFiles(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(CLASS_ATTR)) {
      found.push({
        file: file.slice(SRC_DIR.length),
        classes: (match[1] ?? "").split(/\s+/).filter(Boolean),
      });
    }
  }

  return found;
}

describe("BaseCoat variant classes", () => {
  it("are never combined with their base class", () => {
    const offenders: string[] = [];

    for (const { file, classes } of readClassAttributes()) {
      for (const base of FAMILIES) {
        if (!classes.includes(base)) continue;
        const variant = classes.find(
          (name) => name !== base && name.startsWith(`${base}-`),
        );
        if (variant) {
          offenders.push(`${file}: class="… ${base} ${variant} …"`);
        }
      }
    }

    expect(
      offenders,
      [
        "A BaseCoat variant replaces the base class, it does not modify it.",
        "Drop the bare base and keep the variant alone:",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });

  // A guard is worth nothing if the shape it looks for is not the shape the
  // markup writes, so this pins the reader against real files rather than
  // trusting the regex.
  it("reads class attributes out of the real markup", () => {
    const attributes = readClassAttributes();

    expect(attributes.length).toBeGreaterThan(100);
    expect(attributes.some(({ classes }) => classes.includes("btn"))).toBe(
      true,
    );
    expect(
      attributes.some(({ classes }) => classes.includes("btn-outline")),
    ).toBe(true);
  });
});
