import { describe, expect, it } from "vitest";
import {
  imageExtensionForMimeType,
  isAllowedSideloadImageType,
  sniffImageMimeType,
} from "../upload.js";

describe("isAllowedSideloadImageType", () => {
  it("accepts the full set of displayable image types", () => {
    for (const type of [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
      "image/avif",
      "image/bmp",
      "image/x-icon",
    ]) {
      expect(isAllowedSideloadImageType(type)).toBe(true);
    }
  });

  it("rejects non-image and unknown types", () => {
    expect(isAllowedSideloadImageType("text/html")).toBe(false);
    expect(isAllowedSideloadImageType("application/octet-stream")).toBe(false);
    expect(isAllowedSideloadImageType("image/tiff")).toBe(false);
  });
});

describe("imageExtensionForMimeType", () => {
  it("maps types to extensions", () => {
    expect(imageExtensionForMimeType("image/jpeg")).toBe("jpg");
    expect(imageExtensionForMimeType("image/svg+xml")).toBe("svg");
    expect(imageExtensionForMimeType("image/x-icon")).toBe("ico");
  });

  it("returns null for unsupported types", () => {
    expect(imageExtensionForMimeType("text/html")).toBeNull();
  });
});

describe("sniffImageMimeType", () => {
  const cases: Array<[string, number[]]> = [
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0]],
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/gif", [...new TextEncoder().encode("GIF89a")]],
    [
      "image/webp",
      [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
    ],
    ["image/bmp", [0x42, 0x4d, 0x00, 0x00]],
    ["image/x-icon", [0x00, 0x00, 0x01, 0x00]],
  ];

  it.each(cases)("detects %s from magic bytes", (expected, bytes) => {
    expect(sniffImageMimeType(new Uint8Array(bytes))).toBe(expected);
  });

  it("detects AVIF via the ftyp brand", () => {
    const bytes = new Uint8Array(16);
    bytes.set([...new TextEncoder().encode("ftyp")], 4);
    bytes.set([...new TextEncoder().encode("avif")], 8);
    expect(sniffImageMimeType(bytes)).toBe("image/avif");
  });

  it.each(["heic", "heix", "hevc", "hevx", "mif1", "msf1"])(
    "detects HEIC/HEIF via the %s ftyp brand",
    (brand) => {
      const bytes = new Uint8Array(16);
      bytes.set([...new TextEncoder().encode("ftyp")], 4);
      bytes.set([...new TextEncoder().encode(brand)], 8);
      expect(sniffImageMimeType(bytes)).toBe("image/heic");
    },
  );

  it("keeps HEIC out of the sideload formats", () => {
    expect(isAllowedSideloadImageType("image/heic")).toBe(false);
  });

  it("detects SVG from an <svg> root", () => {
    const svg = new TextEncoder().encode(
      '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );
    expect(sniffImageMimeType(svg)).toBe("image/svg+xml");
  });

  it("returns null for non-image bytes (e.g. HTML)", () => {
    const html = new TextEncoder().encode("<!doctype html><html></html>");
    expect(sniffImageMimeType(html)).toBeNull();
  });
});
