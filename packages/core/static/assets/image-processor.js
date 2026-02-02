/**
 * Client-side Image Processor
 *
 * Processes images before upload:
 * - Corrects EXIF orientation
 * - Resizes to max dimensions
 * - Strips all metadata (privacy)
 * - Converts to WebP format
 */

window.ImageProcessor = (() => {
  const DEFAULT_OPTIONS = {
    maxWidth: 1920,
    maxHeight: 1920,
    quality: 0.85,
    mimeType: 'image/webp',
  };

  /**
   * EXIF Orientation values and their transformations
   * @see https://exiftool.org/TagNames/EXIF.html
   */
  const ORIENTATIONS = {
    1: { rotate: 0, flip: false },     // Normal
    2: { rotate: 0, flip: true },      // Flipped horizontally
    3: { rotate: 180, flip: false },   // Rotated 180°
    4: { rotate: 180, flip: true },    // Flipped vertically
    5: { rotate: 90, flip: true },     // Rotated 90° CCW + flipped
    6: { rotate: 90, flip: false },    // Rotated 90° CW
    7: { rotate: 270, flip: true },    // Rotated 90° CW + flipped
    8: { rotate: 270, flip: false },   // Rotated 90° CCW
  };

  /**
   * Read EXIF orientation from JPEG file
   * @param {ArrayBuffer} buffer - File buffer
   * @returns {number} Orientation value (1-8), defaults to 1
   */
  function readExifOrientation(buffer) {
    const view = new DataView(buffer);

    // Check for JPEG SOI marker
    if (view.getUint16(0) !== 0xFFD8) return 1;

    let offset = 2;
    const length = view.byteLength;

    while (offset < length) {
      if (view.getUint8(offset) !== 0xFF) return 1;

      const marker = view.getUint8(offset + 1);

      // APP1 marker (EXIF)
      if (marker === 0xE1) {
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
        if (view.getUint16(tiffOffset + 2, littleEndian) !== 0x002A) return 1;

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
      if (marker === 0xD8 || marker === 0xD9) {
        offset += 2;
      } else {
        offset += 2 + view.getUint16(offset + 2);
      }
    }

    return 1;
  }

  /**
   * Load image from file
   * @param {File} file - Image file
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        resolve(img);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * Calculate output dimensions maintaining aspect ratio
   * @param {number} width - Original width
   * @param {number} height - Original height
   * @param {number} maxWidth - Maximum width
   * @param {number} maxHeight - Maximum height
   * @returns {{ width: number, height: number }}
   */
  function calculateDimensions(width, height, maxWidth, maxHeight) {
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
   * @param {File} file - Image file to process
   * @param {Object} options - Processing options
   * @returns {Promise<Blob>} Processed image as WebP blob
   */
  async function process(file, options = {}) {
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
      opts.maxHeight
    );

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    // Apply transformations
    ctx.save();

    // Move to center for rotation
    ctx.translate(width / 2, height / 2);

    // Apply rotation
    if (transform.rotate) {
      ctx.rotate((transform.rotate * Math.PI) / 180);
    }

    // Apply flip
    if (transform.flip) {
      ctx.scale(-1, 1);
    }

    // Draw image centered
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
            reject(new Error('Failed to create blob'));
          }
        },
        opts.mimeType,
        opts.quality
      );
    });
  }

  /**
   * Process file and create a new File object
   * @param {File} file - Original file
   * @param {Object} options - Processing options
   * @returns {Promise<File>} Processed file with .webp extension
   */
  async function processToFile(file, options = {}) {
    const blob = await process(file, options);

    // Generate new filename with .webp extension
    const originalName = file.name.replace(/\.[^.]+$/, '');
    const newName = `${originalName}.webp`;

    return new File([blob], newName, { type: 'image/webp' });
  }

  return { process, processToFile };
})();

// Also export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.ImageProcessor;
}
