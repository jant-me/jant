/**
 * Shared Upload Helper with Metadata
 *
 * Processes images via ImageProcessor — resize, WebP, dimensions, blurhash —
 * and uploads them with that metadata attached.
 * Used by paste-media, image-node replace, and inline compose editors.
 */

import { ImageProcessor } from "./image-processor.js";
import { uploadViaSession } from "./upload-session.js";

/**
 * Process an image file and upload it with dimension/blurhash metadata.
 *
 * @returns The server response with url and id
 */
export async function uploadWithMetadata(
  file: File,
): Promise<{ url: string; id: string }> {
  const {
    file: processed,
    width,
    height,
    blurhash,
  } = await ImageProcessor.processToFile(file);

  const result = await uploadViaSession(processed, {
    width,
    height,
    blurhash,
  });

  return {
    url: result.url,
    id: result.id,
  };
}
