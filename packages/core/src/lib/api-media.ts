import type { AppConfig } from "../types/config.js";
import type { Media } from "../types.js";
import { toApiAttachment } from "./api-posts.js";

/**
 * What every media response carries, whatever the file is. Every field is
 * listed here and in docs/API.md's media table; storage internals (the
 * storage key and driver, the stored file name, the position inside a Post)
 * stay out.
 */
interface ApiMediaBase {
  id: string;
  /** The Post this file is attached to, or `null` while it is unattached. */
  postId: string | null;
  mediaKind: Media["mediaKind"];
  mimeType: string;
  /** The file's name as uploaded. */
  originalName: string;
  size: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  alt: string | null;
  blurhash: string | null;
  waveform: string | null;
  summary: string | null;
  chars: number | null;
  createdAt: number;
  updatedAt: number;
}

export type ApiMediaResponse =
  | (ApiMediaBase & {
      type: "media";
      url: string;
      previewUrl: string;
      posterUrl: string | null;
    })
  | (ApiMediaBase & {
      type: "text";
      contentFormat: "markdown";
      contentUrl: string;
    });

/**
 * The author API's view of one uploaded file, for the media endpoints and the
 * MCP media tools.
 *
 * @param media - The stored media row
 * @param appConfig - Public URL settings the file's addresses are built from
 * @returns The media response, with file addresses or, for a text attachment,
 *   where to read its content
 * @example
 * return c.json(toApiMedia(media, c.var.appConfig));
 */
export function toApiMedia(
  media: Media,
  appConfig: Pick<
    AppConfig,
    | "imageTransformUrl"
    | "localPublicUrl"
    | "r2PublicUrl"
    | "s3PublicUrl"
    | "sitePathPrefix"
  >,
): ApiMediaResponse {
  const base: ApiMediaBase = {
    id: media.id,
    postId: media.postId,
    mediaKind: media.mediaKind,
    mimeType: media.mimeType,
    originalName: media.originalName,
    size: media.size,
    width: media.width,
    height: media.height,
    durationSeconds: media.durationSeconds,
    alt: media.alt,
    blurhash: media.blurhash,
    waveform: media.waveform,
    summary: media.summary,
    chars: media.chars,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
  };
  const attachment = toApiAttachment(
    media,
    appConfig.r2PublicUrl,
    appConfig.imageTransformUrl,
    appConfig.s3PublicUrl,
    appConfig.localPublicUrl,
    appConfig.sitePathPrefix,
  );

  if (attachment.type === "text") {
    return {
      ...base,
      type: "text",
      contentFormat: attachment.contentFormat,
      contentUrl: attachment.contentUrl,
    };
  }

  return {
    ...base,
    type: "media",
    url: attachment.url,
    previewUrl: attachment.previewUrl,
    posterUrl: attachment.posterUrl,
  };
}
