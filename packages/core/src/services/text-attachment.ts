/**
 * Text Attachment Service
 *
 * What a reader sees of a text file attached to a post: a Jant-composed text
 * attachment (Markdown, rendered) or an uploaded plain-text file (shown as
 * is). One rule decides who may read it, shared by the attachment's page,
 * `/{post}/text/{id}`, and the preview dialog's `/_/text/{id}`, so the two
 * ways in can't disagree: the file must belong to a published post, and a
 * private one only to the signed-in author.
 */

import { escapeHtml } from "../lib/html.js";
import { markdownToTiptapJson } from "../lib/markdown-to-tiptap.js";
import { requireStorage, type StorageDriver } from "../lib/storage.js";
import { renderTiptapJson } from "../lib/tiptap-render.js";
import type { Media, Post } from "../types.js";
import { isTextAttachment, type MediaService } from "./media.js";
import type { PostService } from "./post.js";

/** A text file as one reader may see it, and the post it belongs to. */
export interface ReaderTextAttachment {
  media: Media;
  post: Post;
  /** Safe to insert: rendered Markdown, or the plain text escaped in `<pre>`. */
  html: string;
  /** The file's text as stored, for copying. */
  source: string;
}

/** Who is asking, and, from an attachment's page, which post it named. */
export interface TextAttachmentViewer {
  isAuthenticated: boolean;
  /** The post the address names; a file attached elsewhere is not found. */
  postId?: string;
}

export interface TextAttachmentService {
  /**
   * A text file as this viewer may see it, or null when it isn't a text
   * file, belongs to no post, the post is a draft, or the post is private and
   * the viewer isn't signed in.
   *
   * @param mediaId - The file's media ID
   * @param viewer - Who is asking
   * @param storage - Where the file's bytes are
   * @returns The file with its rendered HTML and source, or null
   */
  readForViewer(
    mediaId: string,
    viewer: TextAttachmentViewer,
    storage: StorageDriver | null,
  ): Promise<ReaderTextAttachment | null>;
}

/**
 * @param deps - The post and media services the rule reads through
 * @returns The text attachment service
 * @example
 * const textAttachments = createTextAttachmentService({ posts, media });
 */
export function createTextAttachmentService(deps: {
  posts: Pick<PostService, "getById">;
  media: Pick<MediaService, "getById">;
}): TextAttachmentService {
  return {
    async readForViewer(mediaId, viewer, storage) {
      const media = await deps.media.getById(mediaId);
      if (!media?.postId || !media.mimeType.startsWith("text/")) return null;
      if (viewer.postId !== undefined && media.postId !== viewer.postId) {
        return null;
      }

      // Hydrated posts carry their Thread's visibility, so a reply in a
      // private Thread reads as private here.
      const post = await deps.posts.getById(media.postId);
      if (!post || post.status === "draft") return null;
      if (post.visibility === "private" && !viewer.isAuthenticated) {
        return null;
      }

      const object = await requireStorage(storage).get(media.storageKey);
      if (!object) return null;
      const source = await new Response(object.body).text();

      const html = isTextAttachment(media)
        ? renderTiptapJson(markdownToTiptapJson(source), {
            namespace: media.id,
          })
        : `<pre>${escapeHtml(source)}</pre>`;

      return { media, post, html, source };
    },
  };
}
