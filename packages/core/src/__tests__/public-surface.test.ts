/**
 * A release keeps what the last release of its major promised.
 *
 * `docs/compatibility.md` promises that the HTTP API, MCP, feed contents, the
 * command line, configuration, and the export format change only in a major
 * release. The drift tests hold each of those to its docs page in the same
 * commit, so a change that removed an option and its documentation together
 * passed them all. `helpers/public-surface.ts` reads that surface from the
 * code into one manifest. `fixtures/public-surface.json` is head's copy, kept
 * current here, so a change to the surface shows in review as a diff of one
 * file. `scripts/release/freeze-fixtures.mjs` copies it from each release's
 * tag into `fixtures/releases/<version>/`.
 *
 * Head has to keep every name the newest frozen manifest of its major holds.
 * A removal or rename passes only while a pending changeset makes the next
 * release major, and that changeset's upgrade notes say what to change. Before
 * 1.0 there is nothing to keep: a 0.x minor release may still change the
 * second level.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  buildPublicSurface,
  findBaseline,
  findRemovals,
  pendingMajorChangesets,
  PUBLIC_SURFACE_FILE,
  type PublicSurface,
} from "./helpers/public-surface.js";

const CORE_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(CORE_DIR, "../..");
const FIXTURES_DIR = join(import.meta.dirname, "fixtures");
const HEAD_FILE = join(FIXTURES_DIR, PUBLIC_SURFACE_FILE);
const RELEASES_DIR = join(FIXTURES_DIR, "releases");
const UPDATE = process.env.UPDATE_PUBLIC_SURFACE === "1";

function serialize(surface: PublicSurface): string {
  return `${JSON.stringify(surface, null, 2)}\n`;
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

/** A temporary releases directory: each version's manifest, or none. */
function releases(versions: Record<string, PublicSurface | null>): string {
  const root = mkdtempSync(join(tmpdir(), "jant-public-surface-"));
  dirs.push(root);
  for (const [version, frozen] of Object.entries(versions)) {
    mkdirSync(join(root, version, "snapshot"), { recursive: true });
    if (frozen) {
      writeFileSync(
        join(root, version, PUBLIC_SURFACE_FILE),
        serialize(frozen),
      );
    }
  }
  return root;
}

describe("public surface", () => {
  let surface: PublicSurface;

  beforeAll(async () => {
    surface = await buildPublicSurface();
  }, 60_000);

  it("matches fixtures/public-surface.json", () => {
    if (UPDATE) {
      writeFileSync(HEAD_FILE, serialize(surface));
      return;
    }
    const committed: unknown = existsSync(HEAD_FILE)
      ? JSON.parse(readFileSync(HEAD_FILE, "utf8"))
      : null;
    expect(
      surface,
      "The public surface changed. Run `mise run update-public-surface` and commit fixtures/public-surface.json.",
    ).toEqual(committed);
  });

  it("keeps everything the latest release of this major promised", ({
    skip,
  }) => {
    const version = JSON.parse(
      readFileSync(join(CORE_DIR, "package.json"), "utf8"),
    ).version as string;
    const baseline = findBaseline(RELEASES_DIR, version);
    if (!baseline) {
      skip(`No frozen public surface for ${version}'s major yet.`);
      return;
    }

    const removals = findRemovals(baseline.surface, surface);
    if (pendingMajorChangesets(join(REPO_ROOT, ".changeset")).length > 0) {
      return;
    }
    expect(
      removals,
      `${version} drops what ${baseline.version} promised. A removal or rename waits for a major release: keep these, or add a major changeset whose upgrade notes say what to change.`,
    ).toEqual([]);
  });

  it("fails head on a removal and passes it on an addition", () => {
    const cli = surface.cli as Record<string, string[]>;
    const migrate = cli.migrate ?? [];
    expect(migrate.length).toBeGreaterThan(1);
    const frozenAt101 = (frozen: PublicSurface) =>
      findBaseline(releases({ "1.0.1": frozen }), "1.1.0")?.surface ?? {};

    // 1.0.1 promised an option head has since dropped.
    const promisedMore = frozenAt101({
      ...surface,
      cli: { ...cli, migrate: [...migrate, "--retired"] },
    });
    expect(findRemovals(promisedMore, surface)).toEqual([
      "cli.migrate: --retired",
    ]);

    // Head added an option 1.0.1 didn't have.
    const promisedLess = frozenAt101({
      ...surface,
      cli: { ...cli, migrate: migrate.slice(1) },
    });
    expect(findRemovals(promisedLess, surface)).toEqual([]);
  });
});

describe("findRemovals", () => {
  const baseline: PublicSurface = {
    cli: { migrate: ["--local", "--remote"], start: [] },
    mcp: { tools: { jant_posts_list: ["cursor", "limit"] } },
  };

  it("passes an addition", () => {
    expect(
      findRemovals(baseline, {
        cli: { migrate: ["--local", "--node", "--remote"], start: [] },
        mcp: {
          tools: {
            jant_posts_list: ["content", "cursor", "limit"],
            jant_posts_get: ["id"],
          },
        },
        feed: { elements: {} },
      }),
    ).toEqual([]);
  });

  it("names each removed name and key", () => {
    expect(
      findRemovals(baseline, {
        cli: { migrate: ["--remote"] },
        mcp: { tools: { jant_posts_list: ["cursor", "max"] } },
      }),
    ).toEqual([
      "cli.migrate: --local",
      "cli.start",
      "mcp.tools.jant_posts_list: limit",
    ]);
  });

  it("names a key whose shape changed", () => {
    expect(
      findRemovals(baseline, {
        cli: { migrate: { local: [] }, start: [] },
        mcp: { tools: [] },
      }),
    ).toEqual(["cli.migrate", "mcp.tools"]);
  });
});

describe("findBaseline", () => {
  const dir = () =>
    releases(
      Object.fromEntries(
        ["0.12.0", "1.0.1", "1.2.0", "1.10.0-next.0", "1.3.0", "2.0.0"].map(
          (version) => [
            version,
            version === "1.3.0" ? null : { version: [version] },
          ],
        ),
      ),
    );

  it.each([
    ["1.2.0", "1.2.0"],
    ["1.4.0", "1.2.0"],
    ["1.10.0", "1.10.0-next.0"],
    ["1.1.0", "1.0.1"],
    ["2.1.0", "2.0.0"],
  ])("holds %s to %s", (head, frozen) => {
    const baseline = findBaseline(dir(), head);
    expect(baseline?.version).toBe(frozen);
    expect(baseline?.surface).toEqual({ version: [frozen] });
  });

  it.each(["0.12.0", "0.13.0", "1.0.0", "3.0.0"])(
    "holds %s to nothing",
    (head) => {
      expect(findBaseline(dir(), head)).toBeNull();
    },
  );
});

describe("pendingMajorChangesets", () => {
  function changesets(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "jant-changesets-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ fixed: [["@jant/core", "create-jant"]] }),
    );
    writeFileSync(join(dir, "README.md"), "# Changesets\n\nmajor\n");
    for (const [name, frontMatter] of Object.entries(files)) {
      writeFileSync(join(dir, name), `---\n${frontMatter}\n---\n\nNotes.\n`);
    }
    return dir;
  }

  it("finds a major bump of @jant/core or a package released with it", () => {
    expect(
      pendingMajorChangesets(
        changesets({
          "a.md": '"@jant/core": minor\n"create-jant": patch',
          "b.md": '"create-jant": major',
          "c.md": "'@jant/core': major",
          "d.md": '"jant-demo": major',
        }),
      ),
    ).toEqual(["b.md", "c.md"]);
  });

  it("finds none among minor and patch bumps", () => {
    expect(
      pendingMajorChangesets(
        changesets({ "a.md": '"@jant/core": minor', "b.md": "" }),
      ),
    ).toEqual([]);
  });
});
