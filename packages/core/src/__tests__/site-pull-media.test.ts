import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectMediaReferences,
  getSitePathPrefix,
  pullSiteExportDirectory,
  resolveExportUrl,
  toPulledPublicPath,
  updateConfigMediaUrls,
} from "../../bin/lib/site-pull-media.js";

describe("site-pull-media helpers", () => {
  it("collects markdown, html, and attachment media references", () => {
    const content = `
![hero](/media/hero.webp)
<img src="https://example.com/inline.png" alt="">
<video poster="/media/poster.webp"><source src="/media/clip.mp4"></video>
<audio src="/media/memo.mp3"></audio>
<div data-jant-node="attachments">
  <figure data-jant-node="attachment">
    <script type="application/json" data-jant-meta>{"src":"/media/doc.pdf","poster":"/media/doc-poster.webp"}</script>
  </figure>
</div>
`;

    expect(collectMediaReferences(content)).toEqual([
      "/media/hero.webp",
      "https://example.com/inline.png",
      "/media/poster.webp",
      "/media/clip.mp4",
      "/media/memo.mp3",
      "/media/doc.pdf",
      "/media/doc-poster.webp",
    ]);
  });

  it("builds pulled public paths with a site path prefix", () => {
    expect(getSitePathPrefix("https://example.com/blog")).toBe("/blog");
    expect(toPulledPublicPath("media/photo.webp", "/blog")).toBe(
      "/blog/media/photo.webp",
    );
    expect(
      resolveExportUrl("/media/photo.webp", "https://example.com/blog"),
    ).toBe("https://example.com/media/photo.webp");
  });

  it("resolves protocol-relative media URLs to https", () => {
    expect(
      resolveExportUrl(
        "//media-dev.jant.me/media/photo.webp",
        "http://localhost:3000",
      ),
    ).toBe("https://media-dev.jant.me/media/photo.webp");
  });

  it("updates config media URLs when replacements exist", () => {
    const config = {
      params: {
        site_avatar_url: "https://origin.example/media/avatar.webp",
      },
    };
    const replacements = new Map([
      [
        "https://origin.example/media/avatar.webp",
        "/blog/media/local-avatar.webp",
      ],
    ]);

    expect(updateConfigMediaUrls(config, replacements)).toBe(true);
    expect(config.params.site_avatar_url).toBe("/blog/media/local-avatar.webp");
  });

  it("pulls media files into static/media and rewrites content/config", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "jant-pull-media-test-"));

    try {
      await mkdir(join(rootDir, "content", "hello"), { recursive: true });
      await writeFile(
        join(rootDir, "hugo.toml"),
        `baseURL = "https://example.com/blog"

[params]
site_avatar_url = "/media/avatar.webp"
`,
      );
      await writeFile(
        join(rootDir, "content", "hello", "index.md"),
        `---
title: "Hello"
---

![hero](/media/hero.webp)

<div data-jant-node="attachments">
  <figure data-jant-node="attachment">
    <script type="application/json" data-jant-meta>{"src":"/media/report.pdf"}</script>
    <a href="/media/report.pdf">report.pdf</a>
  </figure>
</div>
`,
      );

      const stats = await pullSiteExportDirectory(rootDir, {
        assetLoader: async ({ resolvedUrl }) => ({
          bytes: new TextEncoder().encode(resolvedUrl),
          contentType: resolvedUrl.endsWith(".pdf")
            ? "application/pdf"
            : "image/webp",
        }),
      });

      expect(stats.downloaded).toBe(3);
      expect(stats.filesUpdated).toBe(1);
      expect(stats.configUpdated).toBe(true);

      const content = await readFile(
        join(rootDir, "content", "hello", "index.md"),
        "utf-8",
      );
      expect(content).toContain("/blog/media/");
      expect(content).not.toContain('"/media/hero.webp"');
      expect(content).not.toContain('"/media/report.pdf"');

      const config = await readFile(join(rootDir, "hugo.toml"), "utf-8");
      expect(config).toContain('site_avatar_url = "/blog/media/');

      const pulledFiles = await readdir(join(rootDir, "static", "media"));
      expect(pulledFiles).toHaveLength(3);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("pulls front matter media[] entries including text attachments", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "jant-pull-media-test-"));

    try {
      await mkdir(join(rootDir, "content", "hello"), { recursive: true });
      await writeFile(
        join(rootDir, "hugo.toml"),
        `baseURL = "https://example.com/"
`,
      );
      await writeFile(
        join(rootDir, "content", "hello", "_index.md"),
        `---
title: "Hello"
media:
  - id: "med_text"
    kind: "text"
    src: "https://media.jant.me/media/files/note.md"
    original_name: "note.md"
    mime_type: "text/markdown"
  - id: "med_image"
    kind: "image"
    src: "https://media.jant.me/media/photo.webp"
    poster: "https://media.jant.me/media/photo-thumb.webp"
---

No body image references here.
`,
      );

      const loaded: string[] = [];
      const stats = await pullSiteExportDirectory(rootDir, {
        assetLoader: async ({ resolvedUrl }) => {
          loaded.push(resolvedUrl);
          return {
            bytes: new TextEncoder().encode(resolvedUrl),
            contentType: resolvedUrl.endsWith(".md")
              ? "text/markdown"
              : "image/webp",
          };
        },
      });

      expect(stats.downloaded).toBe(3);
      expect(loaded).toEqual(
        expect.arrayContaining([
          "https://media.jant.me/media/files/note.md",
          "https://media.jant.me/media/photo.webp",
          "https://media.jant.me/media/photo-thumb.webp",
        ]),
      );

      const content = await readFile(
        join(rootDir, "content", "hello", "_index.md"),
        "utf-8",
      );
      expect(content).not.toContain("https://media.jant.me/");
      expect(content).toContain('src: "/media/');
      expect(content).toContain('poster: "/media/');

      const pulledFiles = await readdir(join(rootDir, "static", "media"));
      expect(pulledFiles).toHaveLength(3);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("pulls protocol-relative media references with https asset URLs", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "jant-pull-media-test-"));

    try {
      await mkdir(join(rootDir, "content", "hello"), { recursive: true });
      await writeFile(
        join(rootDir, "hugo.toml"),
        `baseURL = "http://localhost:3000"
`,
      );
      await writeFile(
        join(rootDir, "content", "hello", "index.md"),
        `---
title: "Hello"
---

![hero](//media-dev.jant.me/media/photo.webp)
`,
      );

      const seenResolvedUrls = [];
      const stats = await pullSiteExportDirectory(rootDir, {
        assetLoader: async ({ resolvedUrl }) => {
          seenResolvedUrls.push(resolvedUrl);
          return {
            bytes: new TextEncoder().encode("image"),
            contentType: "image/webp",
          };
        },
      });

      expect(stats.downloaded).toBe(1);
      expect(seenResolvedUrls).toEqual([
        "https://media-dev.jant.me/media/photo.webp",
      ]);

      const content = await readFile(
        join(rootDir, "content", "hello", "index.md"),
        "utf-8",
      );
      expect(content).toContain("](/media/");
      expect(content).not.toContain("//media-dev.jant.me/media/photo.webp");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  // `jant site export --url http://127.0.0.1:3000` exports a site on this
  // machine. Its own files are the export's to download; anything else on a
  // private address is refused, since importing the export publishes it.
  it("downloads from the site being exported even on a private address", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.from([137, 80, 78, 71]));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    const siteOrigin = `http://127.0.0.1:${port}`;
    const exportOf = async () => {
      const rootDir = await mkdtemp(join(tmpdir(), "jant-pull-media-local-"));
      await writeFile(
        join(rootDir, "hugo.toml"),
        `baseURL = "${siteOrigin}/"

[params]
site_avatar_url = "/media/avatar.png"
`,
      );
      return rootDir;
    };

    const own = await exportOf();
    const strict = await exportOf();
    try {
      expect(
        (await pullSiteExportDirectory(own, { siteOrigin })).downloaded,
      ).toBe(1);
      expect(await readdir(join(own, "static", "media"))).toHaveLength(1);

      const refused = await pullSiteExportDirectory(strict, {
        logger: () => {},
      });
      expect(refused.downloaded).toBe(0);
      expect(refused.failed).toBe(1);
    } finally {
      server.close();
      await rm(own, { recursive: true, force: true });
      await rm(strict, { recursive: true, force: true });
    }
  });
});
