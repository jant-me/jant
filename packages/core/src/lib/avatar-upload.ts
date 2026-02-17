/**
 * Client-side Avatar Upload Handler
 *
 * Intercepts avatar file selection to generate favicon variants
 * before uploading. Generates:
 * - favicon.ico (ICO containing 16x16 + 32x32 PNGs)
 * - apple-touch-icon.png (180x180 PNG)
 *
 * Uses the `[data-avatar-upload]` attribute on file inputs.
 */

import { encodeIco } from "./favicon.js";

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

  // Cover crop: scale to fill square, crop center
  const scale = Math.max(size / img.width, size / img.height);
  const sw = size / scale;
  const sh = size / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to create PNG blob"));
      },
      "image/png",
    );
  });
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

    // Generate variants in parallel
    const [png16, png32, png180] = await Promise.all([
      resizeToSquarePng(img, 16),
      resizeToSquarePng(img, 32),
      resizeToSquarePng(img, 180),
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

    // Build FormData with original + variants
    const formData = new FormData();
    formData.append("file", file);
    formData.append("favicon", icoBlob, "favicon.ico");
    formData.append("appleTouch", png180, "apple-touch-icon.png");

    // Upload
    const response = await fetch("/dash/settings/avatar", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Upload failed");
    }

    // Redirect on success
    window.location.href = "/dash/settings?saved";
  } catch {
    // Restore button text on error
    if (label) label.textContent = originalText;
    // Show error toast
    const errorMsg =
      input.dataset.textError || "Upload failed. Please try again.";
    const container = document.getElementById("toast-container");
    if (container) {
      const toast = document.createElement("div");
      toast.className = "toast toast-error";
      toast.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg><span>${errorMsg}</span>`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.classList.add("toast-out");
        toast.addEventListener("animationend", () => toast.remove());
      }, 3000);
    }
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
