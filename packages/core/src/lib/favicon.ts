/**
 * Favicon Utilities
 *
 * Sizes and ICO encoding for generated favicon variants.
 * Favicon data is stored as base64 in the settings table (not R2)
 * since the files are tiny and accessed on every page load.
 */

/**
 * Favicon variant sizes (width x height in pixels)
 */
export const FAVICON_SIZES = {
  ICO_16: 16,
  ICO_32: 32,
  APPLE_TOUCH: 180,
} as const;

/**
 * Encode PNG images into an ICO file.
 *
 * ICO format (with PNG payloads):
 * - Header: 6 bytes (reserved=0, type=1, count=N)
 * - Directory: 16 bytes per entry (width, height, colors, reserved, planes, bpp, size, offset)
 * - Data: raw PNG bytes for each entry
 *
 * @param entries - Array of { size, png } where png is an ArrayBuffer of PNG data
 * @returns ICO file as a Blob
 *
 * @example
 * ```ts
 * const ico = encodeIco([
 *   { size: 16, png: png16ArrayBuffer },
 *   { size: 32, png: png32ArrayBuffer },
 * ]);
 * ```
 */
export function encodeIco(
  entries: { size: number; png: ArrayBuffer }[],
): Blob {
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = entries.length * dirEntrySize;

  let dataOffset = headerSize + dirSize;

  // Build header + directory
  const header = new ArrayBuffer(headerSize + dirSize);
  const view = new DataView(header);

  // ICO header
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type = icon
  view.setUint16(4, entries.length, true); // count

  const pngBuffers: ArrayBuffer[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const offset = headerSize + i * dirEntrySize;

    // Width/height: 0 means 256
    view.setUint8(offset + 0, entry.size < 256 ? entry.size : 0);
    view.setUint8(offset + 1, entry.size < 256 ? entry.size : 0);
    view.setUint8(offset + 2, 0); // color count (0 for >256 colors)
    view.setUint8(offset + 3, 0); // reserved
    view.setUint16(offset + 4, 1, true); // color planes
    view.setUint16(offset + 6, 32, true); // bits per pixel
    view.setUint32(offset + 8, entry.png.byteLength, true); // image size
    view.setUint32(offset + 12, dataOffset, true); // image offset

    dataOffset += entry.png.byteLength;
    pngBuffers.push(entry.png);
  }

  return new Blob([header, ...pngBuffers], { type: "image/x-icon" });
}

/**
 * Convert an ArrayBuffer to a base64 string.
 *
 * @param buffer - The ArrayBuffer to encode
 * @returns base64-encoded string
 *
 * @example
 * ```ts
 * const b64 = arrayBufferToBase64(await blob.arrayBuffer());
 * ```
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Convert a base64 string to a Uint8Array.
 *
 * @param base64 - The base64 string to decode
 * @returns decoded Uint8Array
 *
 * @example
 * ```ts
 * const bytes = base64ToUint8Array(storedBase64);
 * ```
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
