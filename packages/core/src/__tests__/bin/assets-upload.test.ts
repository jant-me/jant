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

describe("stale encoding detection", () => {
  // `findStaleEncodingKeys` is not exported — it needs a live S3 client — so
  // these pin the decision it is built on: which files we expect to find
  // stored as brotli, and which correctly have no `Content-Encoding`.
  it("expects compression for the types that carry the reader payload", () => {
    const body = Buffer.from(".x{color:red}".repeat(400), "utf8");

    // A CJK stylesheet is the case that motivated this: its key never changes,
    // so it was skipped forever and kept being compressed at the CDN's own low
    // quality on every request.
    for (const name of ["client-cjk-B7Z0snDu.css", "client-CDPZMBLo.js"]) {
      expect(compressForUpload(name, body)).not.toBeNull();
    }
  });

  it("expects no compression where storing raw is the right answer", () => {
    // Anything here would be re-uploaded on every run if a missing
    // `Content-Encoding` counted as stale.
    const dense = Buffer.from("y".repeat(4000), "utf8");
    expect(compressForUpload("subset.woff2", dense)).toBeNull();

    const tiny = Buffer.from([0x7a, 0x1b, 0x4f, 0x22]);
    expect(compressForUpload("meta.json", tiny)).toBeNull();
  });
});
