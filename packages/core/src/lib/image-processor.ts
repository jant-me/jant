/**
 * Client-side Image Processor
 *
 * Processes images before upload:
 * - Corrects EXIF orientation
 * - Resizes to max dimensions
 * - Strips all metadata (privacy)
 * - Converts to WebP format
 */

const DEFAULT_OPTIONS = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.85,
  mimeType: "image/webp" as const,
};

type ProcessOptions = Partial<typeof DEFAULT_OPTIONS>;

/**
 * EXIF Orientation values and their transformations
 */
const ORIENTATIONS: Record<number, { rotate: number; flip: boolean }> = {
  1: { rotate: 0, flip: false }, // Normal
  2: { rotate: 0, flip: true }, // Flipped horizontally
  3: { rotate: 180, flip: false }, // Rotated 180°
  4: { rotate: 180, flip: true }, // Flipped vertically
  5: { rotate: 90, flip: true }, // Rotated 90° CCW + flipped
  6: { rotate: 90, flip: false }, // Rotated 90° CW
  7: { rotate: 270, flip: true }, // Rotated 90° CW + flipped
  8: { rotate: 270, flip: false }, // Rotated 90° CCW
};

/**
 * Read EXIF orientation from JPEG file
 */
function readExifOrientation(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);

  // Check for JPEG SOI marker
  if (view.getUint16(0) !== 0xffd8) return 1;

  let offset = 2;
  const length = view.byteLength;

  while (offset < length) {
    if (view.getUint8(offset) !== 0xff) return 1;

    const marker = view.getUint8(offset + 1);

    // APP1 marker (EXIF)
    if (marker === 0xe1) {
      const exifOffset = offset + 4;

      // Check for "Exif\0\0"
      if (
        view.getUint32(exifOffset) !== 0x45786966 ||
        view.getUint16(exifOffset + 4) !== 0x0000
      ) {
        return 1;
      }

      const tiffOffset = exifOffset + 6;
      const littleEndian = view.getUint16(tiffOffset) === 0x4949;

      // Validate TIFF header
      if (view.getUint16(tiffOffset + 2, littleEndian) !== 0x002a) return 1;

      const ifdOffset = view.getUint32(tiffOffset + 4, littleEndian);
      const numEntries = view.getUint16(tiffOffset + ifdOffset, littleEndian);

      // Search for orientation tag (0x0112)
      for (let i = 0; i < numEntries; i++) {
        const entryOffset = tiffOffset + ifdOffset + 2 + i * 12;
        const tag = view.getUint16(entryOffset, littleEndian);

        if (tag === 0x0112) {
          return view.getUint16(entryOffset + 8, littleEndian);
        }
      }

      return 1;
    }

    // Skip to next marker
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
    } else {
      offset += 2 + view.getUint16(offset + 2);
    }
  }

  return 1;
}

/**
 * Load image from file
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
 * Calculate output dimensions maintaining aspect ratio
 */
function calculateDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height };
  }

  const ratio = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

/**
 * Process image file
 */
async function process(
  file: File,
  options: ProcessOptions = {},
): Promise<Blob> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Read file buffer for EXIF
  const buffer = await file.arrayBuffer();
  const orientation = readExifOrientation(buffer);
  const transform = ORIENTATIONS[orientation] || ORIENTATIONS[1];

  // Load image
  const img = await loadImage(file);

  // For 90° or 270° rotation, swap dimensions
  const isRotated = transform.rotate === 90 || transform.rotate === 270;
  const srcWidth = isRotated ? img.height : img.width;
  const srcHeight = isRotated ? img.width : img.height;

  // Calculate output size
  const { width, height } = calculateDimensions(
    srcWidth,
    srcHeight,
    opts.maxWidth,
    opts.maxHeight,
  );

  // Create canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");

  // Apply transformations
  ctx.save();
  ctx.translate(width / 2, height / 2);

  if (transform.rotate) {
    ctx.rotate((transform.rotate * Math.PI) / 180);
  }

  if (transform.flip) {
    ctx.scale(-1, 1);
  }

  const drawWidth = isRotated ? height : width;
  const drawHeight = isRotated ? width : height;
  ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

  ctx.restore();

  // Export as WebP
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create blob"));
        }
      },
      opts.mimeType,
      opts.quality,
    );
  });
}

/**
 * Process file and create a new File object
 */
async function processToFile(
  file: File,
  options: ProcessOptions = {},
): Promise<File> {
  const blob = await process(file, options);

  // Generate new filename with .webp extension
  const originalName = file.name.replace(/\.[^.]+$/, "");
  const newName = `${originalName}.webp`;

  return new File([blob], newName, { type: "image/webp" });
}

export const ImageProcessor = { process, processToFile };

// Expose globally for inline scripts
if (typeof window !== "undefined") {
  (
    window as unknown as { ImageProcessor: typeof ImageProcessor }
  ).ImageProcessor = ImageProcessor;
}
