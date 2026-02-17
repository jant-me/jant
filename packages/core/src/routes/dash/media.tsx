/**
 * Dashboard Media Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../ui/layouts/DashLayout.js";
import { dsRedirect } from "../../lib/sse.js";
import { getSiteName } from "../../lib/config.js";
import {
  getMediaUrl,
  getImageUrl,
  getPublicUrlForProvider,
} from "../../lib/image.js";
import { MediaListContent } from "../../ui/dash/media/MediaListContent.js";
import { ViewMediaContent } from "../../ui/dash/media/ViewMediaContent.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const mediaRoutes = new Hono<Env>();

// List media
mediaRoutes.get("/", async (c) => {
  const mediaList = await c.var.services.media.list(100);
  const siteName = await getSiteName(c);

  return c.html(
    <DashLayout
      c={c}
      title="Media"
      siteName={siteName}
      currentPath="/dash/media"
    >
      <MediaListContent
        mediaList={mediaList}
        r2PublicUrl={c.env.R2_PUBLIC_URL}
        imageTransformUrl={c.env.IMAGE_TRANSFORM_URL}
        s3PublicUrl={c.env.S3_PUBLIC_URL}
      />
    </DashLayout>,
  );
});

// Media picker (returns HTML fragment for PostForm dialog)
// Must be defined before /:id to avoid "picker" matching as an ID
mediaRoutes.get("/picker", async (c) => {
  const mediaList = await c.var.services.media.list(100);
  const r2PublicUrl = c.env.R2_PUBLIC_URL;
  const imageTransformUrl = c.env.IMAGE_TRANSFORM_URL;
  const s3PublicUrl = c.env.S3_PUBLIC_URL;

  if (mediaList.length === 0) {
    return c.html(
      <p class="text-muted-foreground text-sm col-span-4">
        No media uploaded yet. Upload media from the Media page first.
      </p>,
    );
  }

  return c.html(
    <>
      {mediaList
        .filter((m) => m.mimeType.startsWith("image/"))
        .map((m) => {
          const pUrl = getPublicUrlForProvider(
            m.provider,
            r2PublicUrl,
            s3PublicUrl,
          );
          const url = getMediaUrl(m.storageKey, pUrl);
          const thumbUrl = getImageUrl(url, imageTransformUrl, {
            width: 150,
            quality: 80,
            format: "auto",
            fit: "cover",
          });
          return (
            <button
              key={m.id}
              type="button"
              class="aspect-square rounded-lg overflow-hidden border-2 hover:border-primary cursor-pointer transition-colors"
              data-on:click={`$mediaIds.includes('${m.id}') ? ($mediaIds = $mediaIds.filter(id => id !== '${m.id}')) : ($mediaIds = [...$mediaIds, '${m.id}'])`}
              data-class:border-primary={`$mediaIds.includes('${m.id}')`}
              data-class:ring-2={`$mediaIds.includes('${m.id}')`}
              data-class:ring-primary={`$mediaIds.includes('${m.id}')`}
            >
              <img
                src={thumbUrl}
                alt={m.alt || m.originalName}
                class="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          );
        })}
    </>,
  );
});

// View single media
mediaRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const media = await c.var.services.media.getById(id);
  if (!media) return c.notFound();

  const siteName = await getSiteName(c);

  return c.html(
    <DashLayout
      c={c}
      title={media.originalName}
      siteName={siteName}
      currentPath="/dash/media"
    >
      <ViewMediaContent
        media={media}
        r2PublicUrl={c.env.R2_PUBLIC_URL}
        imageTransformUrl={c.env.IMAGE_TRANSFORM_URL}
        s3PublicUrl={c.env.S3_PUBLIC_URL}
      />
    </DashLayout>,
  );
});

// Delete media
mediaRoutes.post("/:id/delete", async (c) => {
  const id = c.req.param("id");
  const media = await c.var.services.media.getById(id);
  if (!media) return c.notFound();

  // Delete from storage
  const storage = c.var.storage;
  if (storage) {
    try {
      await storage.delete(media.storageKey);
    } catch (err) {
      // eslint-disable-next-line no-console -- Error logging is intentional
      console.error("Storage delete error:", err);
    }
  }

  // Delete from database
  await c.var.services.media.delete(id);

  return dsRedirect("/dash/media");
});
