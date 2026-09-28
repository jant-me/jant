/**
 * Client-side Avatar Upload Handler
 *
 * Intercepts avatar file selection to generate favicon variants
 * before uploading. Generates:
 * - favicon.ico (ICO containing 16x16 + 32x32 PNGs)
 * - apple-touch-icon.png (high-resolution PNG for iOS home screen icons)
 *
 * Uses the `[data-avatar-upload]` attribute on file inputs.
 */

import { encodeIco, FAVICON_SIZES } from "../lib/favicon.js";
import { getJsonString, readJsonObject } from "./json.js";
import { publicPath } from "./runtime-paths.js";
import { showToast } from "./toast.js";

const MIN_APPLE_TOUCH_SOURCE_SIZE = 180;

/**
 * Load an image from a File object
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Resize image to a square PNG using center crop.
 *
 * @param img - Source HTMLImageElement
 * @param size - Target width and height in pixels
 * @returns PNG Blob at the target size
 */
function resizeToSquarePng(img: HTMLImageElement, size: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Cover crop: scale to fill square, crop center
  const scale = Math.max(size / img.width, size / img.height);
  const sw = size / scale;
  const sh = size / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to create PNG blob"));
    }, "image/png");
  });
}

/**
 * Preserve uploaded PNGs when they already meet the minimum apple-touch-icon
 * requirements so iOS keeps the original colors and detail.
 */
function canReuseOriginalAppleTouch(
  file: File,
  img: HTMLImageElement,
): boolean {
  return (
    file.type === "image/png" &&
    img.width === img.height &&
    img.width >= MIN_APPLE_TOUCH_SOURCE_SIZE &&
    img.height >= MIN_APPLE_TOUCH_SOURCE_SIZE
  );
}

/**
 * Process avatar file and upload with favicon variants.
 *
 * @param input - The file input element with `data-avatar-upload` attribute
 * @param file - The selected file
 */
async function handleAvatarUpload(
  input: HTMLInputElement,
  file: File,
): Promise<void> {
  // Find the parent form for the loading button
  const form = input.closest("form");
  const label = form?.querySelector("label");
  const originalText = label?.textContent ?? "";

  try {
    // Show processing state
    if (label)
      label.textContent = input.dataset.textProcessing || "Processing...";

    // Load the image
    const img = await loadImage(file);

    // Resize avatar to a 512x512 PNG. SVGs are rasterized too: the server
    // stores only PNG, JPEG, and WebP avatars, because an SVG opened from
    // the site's own origin could carry script.
    const png512 = await resizeToSquarePng(img, 512);
    const avatarFile = new File(
      [png512],
      file.name.replace(/\.[^.]+$/, ".png"),
      { type: "image/png" },
    );
    const avatarFilename = avatarFile.name;

    const appleTouchBlobPromise = canReuseOriginalAppleTouch(file, img)
      ? Promise.resolve<Blob>(file)
      : resizeToSquarePng(img, FAVICON_SIZES.APPLE_TOUCH);

    // Generate favicon variants in parallel
    const [png16, png32, appleTouchBlob] = await Promise.all([
      resizeToSquarePng(img, 16),
      resizeToSquarePng(img, 32),
      appleTouchBlobPromise,
    ]);

    // Encode ICO with 16x16 and 32x32
    const [png16Buf, png32Buf] = await Promise.all([
      png16.arrayBuffer(),
      png32.arrayBuffer(),
    ]);
    const icoBlob = encodeIco([
      { size: 16, png: png16Buf },
      { size: 32, png: png32Buf },
    ]);

    // Show uploading state
    if (label)
      label.textContent = input.dataset.textUploading || "Uploading...";

    // Build FormData with resized avatar + variants
    const formData = new FormData();
    formData.append("file", avatarFile, avatarFilename);
    formData.append("favicon", icoBlob, "favicon.ico");
    formData.append("appleTouch", appleTouchBlob, "apple-touch-icon.png");

    // Upload
    const response = await fetch(publicPath("/settings/avatar"), {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: formData,
    });

    if (!response.ok) {
      let message =
        input.dataset.textError || "Upload failed. Please try again.";
      try {
        const json = await readJsonObject(response);
        message =
          getJsonString(json, "error") ??
          getJsonString(json, "message") ??
          message;
      } catch {
        // Ignore JSON parse failure and keep the fallback copy.
      }
      throw new Error(message);
    }

    const json = await readJsonObject(response);
    const status = getJsonString(json, "status");
    const url = getJsonString(json, "url");

    if (status === "redirect" && url) {
      window.location.href = url;
      return;
    }

    // Fallback for older success responses that don't return JSON redirect data.
    window.location.href = publicPath("/settings/avatar?saved");
  } catch (error) {
    // Restore button text on error
    if (label) label.textContent = originalText;
    showToast(
      error instanceof Error && error.message
        ? error.message
        : input.dataset.textError || "Upload failed. Please try again.",
      "error",
    );
  }

  // Reset file input so the same file can be re-selected
  input.value = "";
}

/**
 * Initialize avatar upload via event delegation
 */
function initAvatarUpload(): void {
  document.addEventListener("change", (e) => {
    const input = (e.target as HTMLElement).closest(
      "[data-avatar-upload]",
    ) as HTMLInputElement | null;
    if (!input?.files?.[0]) return;

    // Prevent default form submission (Datastar data-on:change)
    e.stopPropagation();
    handleAvatarUpload(input, input.files[0]);
  });
}

initAvatarUpload();
