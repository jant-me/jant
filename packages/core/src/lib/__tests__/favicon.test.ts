import { describe, it, expect } from "vitest";
import {
  FAVICON_SIZES,
  encodeIco,
  arrayBufferToBase64,
  base64ToUint8Array,
} from "../favicon.js";

describe("FAVICON_SIZES", () => {
  it("has correct ICO sizes", () => {
    expect(FAVICON_SIZES.ICO_16).toBe(16);
    expect(FAVICON_SIZES.ICO_32).toBe(32);
  });

  it("has correct apple-touch-icon size", () => {
    expect(FAVICON_SIZES.APPLE_TOUCH).toBe(180);
  });
});

describe("encodeIco", () => {
  it("produces a valid ICO blob with correct type", () => {
    const png = new ArrayBuffer(8);
    const result = encodeIco([{ size: 32, png }]);

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("image/x-icon");
  });

  it("produces correct ICO header for single entry", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const result = encodeIco([{ size: 32, png }]);

    const buffer = await result.arrayBuffer();
    const view = new DataView(buffer);

    // ICO header
    expect(view.getUint16(0, true)).toBe(0); // reserved
    expect(view.getUint16(2, true)).toBe(1); // type = icon
    expect(view.getUint16(4, true)).toBe(1); // count = 1

    // Directory entry
    expect(view.getUint8(6)).toBe(32); // width
    expect(view.getUint8(7)).toBe(32); // height
    expect(view.getUint8(8)).toBe(0); // color count
    expect(view.getUint8(9)).toBe(0); // reserved
    expect(view.getUint16(10, true)).toBe(1); // planes
    expect(view.getUint16(12, true)).toBe(32); // bits per pixel
    expect(view.getUint32(14, true)).toBe(4); // image data size
    expect(view.getUint32(18, true)).toBe(22); // offset (6 header + 16 dir entry)
  });

  it("produces correct ICO with multiple entries", async () => {
    const png16 = new Uint8Array([1, 2, 3]).buffer;
    const png32 = new Uint8Array([4, 5, 6, 7]).buffer;

    const result = encodeIco([
      { size: 16, png: png16 },
      { size: 32, png: png32 },
    ]);

    const buffer = await result.arrayBuffer();
    const view = new DataView(buffer);

    // Header
    expect(view.getUint16(4, true)).toBe(2); // count = 2

    // First entry (16x16)
    expect(view.getUint8(6)).toBe(16); // width
    expect(view.getUint8(7)).toBe(16); // height
    expect(view.getUint32(14, true)).toBe(3); // data size
    expect(view.getUint32(18, true)).toBe(38); // offset (6 + 2*16 = 38)

    // Second entry (32x32)
    expect(view.getUint8(22)).toBe(32); // width
    expect(view.getUint8(23)).toBe(32); // height
    expect(view.getUint32(30, true)).toBe(4); // data size
    expect(view.getUint32(34, true)).toBe(41); // offset (38 + 3 = 41)

    // Verify PNG data is embedded
    const data = new Uint8Array(buffer);
    expect(data[38]).toBe(1);
    expect(data[39]).toBe(2);
    expect(data[40]).toBe(3);
    expect(data[41]).toBe(4);
    expect(data[42]).toBe(5);
  });

  it("handles 256px size by setting width/height to 0", async () => {
    const png = new ArrayBuffer(4);
    const result = encodeIco([{ size: 256, png }]);

    const buffer = await result.arrayBuffer();
    const view = new DataView(buffer);

    expect(view.getUint8(6)).toBe(0); // 0 means 256
    expect(view.getUint8(7)).toBe(0); // 0 means 256
  });

  it("total blob size matches header + directory + data", async () => {
    const png1 = new ArrayBuffer(100);
    const png2 = new ArrayBuffer(200);

    const result = encodeIco([
      { size: 16, png: png1 },
      { size: 32, png: png2 },
    ]);

    const buffer = await result.arrayBuffer();
    // 6 (header) + 2*16 (directory) + 100 + 200 (data) = 338
    expect(buffer.byteLength).toBe(338);
  });
});

describe("arrayBufferToBase64", () => {
  it("encodes an empty buffer", () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
  });

  it("encodes simple bytes", () => {
    const buf = new Uint8Array([72, 101, 108, 108, 111]).buffer; // "Hello"
    expect(arrayBufferToBase64(buf)).toBe("SGVsbG8=");
  });

  it("encodes binary data correctly", () => {
    const buf = new Uint8Array([0, 255, 128, 64]).buffer;
    const b64 = arrayBufferToBase64(buf);
    // Verify round-trip
    const decoded = base64ToUint8Array(b64);
    expect(Array.from(decoded)).toEqual([0, 255, 128, 64]);
  });
});

describe("base64ToUint8Array", () => {
  it("decodes an empty string", () => {
    expect(base64ToUint8Array("").length).toBe(0);
  });

  it("decodes simple base64", () => {
    const result = base64ToUint8Array("SGVsbG8=");
    expect(Array.from(result)).toEqual([72, 101, 108, 108, 111]); // "Hello"
  });

  it("round-trips with arrayBufferToBase64", () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;

    const b64 = arrayBufferToBase64(original.buffer);
    const decoded = base64ToUint8Array(b64);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});
