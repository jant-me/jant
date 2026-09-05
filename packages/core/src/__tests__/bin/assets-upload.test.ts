import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compressForUpload } from "../../../bin/commands/assets/upload.js";

describe("compressForUpload", () => {
  it("compresses text assets and round-trips them unchanged", () => {
    // Repetitive like real CSS, so brotli has something to work with.
    const body = Buffer.from(
      ".a{color:var(--site-text-primary)}".repeat(200),
      "utf8",
    );

    const packed = compressForUpload("client.css", body);

    expect(packed).not.toBeNull();
    expect(packed!.length).toBeLessThan(body.length);
    expect(brotliDecompressSync(packed!).equals(body)).toBe(true);
  });

  it("leaves already-compressed types alone", () => {
    // Running brotli over a woff2 or a png costs build time and usually grows
    // the file; the CDN would then serve a needless encoding header too.
    const body = Buffer.from("x".repeat(5000), "utf8");

    for (const name of ["font.woff2", "logo.png", "icon.ico", "photo.jpg"]) {
      expect(compressForUpload(name, body)).toBeNull();
    }
  });

  it("falls back to the raw body when compression does not shrink it", () => {
    // A few random bytes come back larger once the brotli header is added.
    const body = Buffer.from([0x1f, 0x2e, 0x3d, 0x4c]);

    expect(compressForUpload("tiny.json", body)).toBeNull();
  });

  it("matches on the extension case-insensitively", () => {
    const body = Buffer.from("body{margin:0}".repeat(200), "utf8");

    expect(compressForUpload("STYLE.CSS", body)).not.toBeNull();
  });
});
