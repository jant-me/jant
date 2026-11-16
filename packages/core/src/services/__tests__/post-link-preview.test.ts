import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import type { Database } from "../../db/index.js";
import type { ResolvedLinkPreview } from "../../lib/link-preview.js";
import { createMediaService } from "../media.js";
import { createPostService } from "../post.js";

// The page and the images it names are the library's to fetch (it has its
// own tests); here the service only decides when to resolve and what to keep.
const resolveLinkPreview = vi.hoisted(() =>
  vi.fn<(url: string) => Promise<ResolvedLinkPreview>>(),
);
vi.mock("../../lib/link-preview.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/link-preview.js")>()),
  resolveLinkPreview,
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const ICO = new Uint8Array([0x00, 0x00, 0x01, 0x00]);

function videoPreview(provider: string | null): ResolvedLinkPreview {
  return {
    image: { bytes: JPEG, contentType: "image/jpeg", ext: "jpg" },
    kind: "video",
    provider,
    icon: { bytes: PNG, contentType: "image/png", ext: "png" },
  };
}

function iconOnly(): ResolvedLinkPreview {
  return {
    image: null,
    kind: null,
    provider: null,
    icon: { bytes: ICO, contentType: "image/x-icon", ext: "ico" },
  };
}

const NOTHING: ResolvedLinkPreview = {
  image: null,
  kind: null,
  provider: null,
  icon: null,
};

function createMockStorage() {
  const files = new Map<string, { body: Uint8Array; contentType?: string }>();
  return {
    files,
    async put(
      key: string,
      body: Uint8Array | ReadableStream,
      opts?: { contentType?: string },
    ) {
      const bytes =
        body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body).arrayBuffer());
      files.set(key, { body: bytes, contentType: opts?.contentType });
    },
    async get(key: string) {
      const file = files.get(key);
      if (!file) return null;
      return {
        body: new Response(file.body).body as ReadableStream,
        contentType: file.contentType,
      };
    },
    async delete(key: string) {
      files.delete(key);
    },
  };
}

describe("PostService link previews", () => {
  let postService: ReturnType<typeof createPostService>;
  let storage: ReturnType<typeof createMockStorage>;
  let deps: Parameters<
    ReturnType<typeof createPostService>["createWithAttachments"]
  >[2];

  beforeEach(() => {
    resolveLinkPreview.mockReset();
    resolveLinkPreview.mockResolvedValue(NOTHING);
    const { db } = createTestDatabase();
    const database = db as unknown as Database;
    postService = createPostService(
      database,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
    );
    storage = createMockStorage();
    deps = {
      media: createMediaService(database, DEFAULT_TEST_SITE_ID),
      storage,
      storageDriver: "local",
      maxFileSizeMB: 1,
    };
  });

  async function createLink(url: string) {
    return postService.createWithAttachments(
      { format: "link", url, title: "A link" },
      [],
      deps,
    );
  }

  it("stores a video's thumbnail, provider, and the site's icon", async () => {
    resolveLinkPreview.mockResolvedValue(videoPreview("bilibili"));

    const created = await createLink(
      "https://www.bilibili.com/video/BV1GJ411x7h7",
    );
    const post = await postService.getById(created.id);

    expect(resolveLinkPreview).toHaveBeenCalledWith(
      "https://www.bilibili.com/video/BV1GJ411x7h7",
    );
    expect(post?.previewKind).toBe("video");
    expect(post?.previewProvider).toBe("bilibili");
    expect(post?.previewImageKey).toMatch(/\.jpg$/);
    expect(post?.previewIconKey).toMatch(/-icon-[a-z0-9]+\.png$/i);
    expect(storage.files.get(post?.previewImageKey ?? "")?.contentType).toBe(
      "image/jpeg",
    );
    expect(storage.files.get(post?.previewIconKey ?? "")?.contentType).toBe(
      "image/png",
    );
  });

  it("stores only the icon for a page that isn't a video", async () => {
    resolveLinkPreview.mockResolvedValue(iconOnly());

    const created = await createLink("https://example.com/essay");
    const post = await postService.getById(created.id);

    expect(post?.previewImageKey).toBeNull();
    expect(post?.previewKind).toBeNull();
    expect(post?.previewProvider).toBeNull();
    expect(post?.previewIconKey).toMatch(/\.ico$/);
    expect(storage.files.size).toBe(1);
  });

  it("doesn't resolve a preview for a Note", async () => {
    await postService.createWithAttachments(
      { format: "note", bodyMarkdown: "Just words" },
      [],
      deps,
    );

    expect(resolveLinkPreview).not.toHaveBeenCalled();
  });

  it("doesn't resolve a preview without storage to keep it in", async () => {
    await postService.createWithAttachments(
      { format: "link", url: "https://example.com/", title: "A link" },
      [],
      { ...deps, storage: null },
    );

    expect(resolveLinkPreview).not.toHaveBeenCalled();
  });

  it("replaces the preview and deletes the old files when the URL changes", async () => {
    resolveLinkPreview.mockResolvedValue(videoPreview("vimeo"));
    const created = await createLink("https://vimeo.com/76979871");
    const before = await postService.getById(created.id);

    resolveLinkPreview.mockResolvedValue(iconOnly());
    await postService.updateWithAttachments(
      created.id,
      { url: "https://example.com/essay" },
      undefined,
      deps,
    );
    const after = await postService.getById(created.id);

    expect(after?.previewImageKey).toBeNull();
    expect(after?.previewKind).toBeNull();
    expect(after?.previewProvider).toBeNull();
    expect(after?.previewIconKey).toMatch(/\.ico$/);
    expect(storage.files.has(before?.previewImageKey ?? "")).toBe(false);
    expect(storage.files.has(before?.previewIconKey ?? "")).toBe(false);
    expect([...storage.files.keys()]).toEqual([after?.previewIconKey]);
  });

  it("clears the preview when the post stops being a Link", async () => {
    resolveLinkPreview.mockResolvedValue(videoPreview("youtube"));
    const created = await createLink("https://youtu.be/dQw4w9WgXcQ");
    resolveLinkPreview.mockClear();

    await postService.updateWithAttachments(
      created.id,
      { format: "note", url: null, title: null, bodyMarkdown: "Now a note" },
      undefined,
      deps,
    );
    const after = await postService.getById(created.id);

    expect(resolveLinkPreview).not.toHaveBeenCalled();
    expect(after?.previewImageKey).toBeNull();
    expect(after?.previewIconKey).toBeNull();
    expect(storage.files.size).toBe(0);
  });

  it("keeps the preview when the URL doesn't change", async () => {
    resolveLinkPreview.mockResolvedValue(videoPreview("youtube"));
    const created = await createLink("https://youtu.be/dQw4w9WgXcQ");
    const before = await postService.getById(created.id);
    resolveLinkPreview.mockClear();

    await postService.updateWithAttachments(
      created.id,
      { title: "A better title" },
      undefined,
      deps,
    );
    const after = await postService.getById(created.id);

    expect(resolveLinkPreview).not.toHaveBeenCalled();
    expect(after?.previewImageKey).toBe(before?.previewImageKey);
    expect(after?.previewIconKey).toBe(before?.previewIconKey);
  });

  it("deletes the thumbnail and the icon with the post", async () => {
    resolveLinkPreview.mockResolvedValue(videoPreview("youtube"));
    const created = await createLink("https://youtu.be/dQw4w9WgXcQ");
    expect(storage.files.size).toBe(2);

    await postService.delete(created.id, { media: deps.media, storage });

    expect(storage.files.size).toBe(0);
  });
});
