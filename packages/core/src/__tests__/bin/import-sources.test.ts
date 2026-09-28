import { afterEach, describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() =>
  vi.fn(async (_host: string, _options?: unknown) => [
    { address: "93.184.215.14", family: 4 },
  ]),
);
vi.mock("node:dns/promises", () => ({ lookup, default: { lookup } }));

const { assertPublicUrl, fetchPublic, isPrivateAddress, resolveInside } =
  await import("../../../bin/lib/import-sources.js");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveInside", () => {
  it("keeps a path inside the export", () => {
    expect(resolveInside("/tmp/site", "static", "media/a.webp")).toBe(
      "/tmp/site/static/media/a.webp",
    );
  });

  it.each(["../../.ssh/id_rsa", "/etc/passwd", "media/../../../x"])(
    "refuses %s, which leaves it",
    (path) => {
      expect(resolveInside("/tmp/site/static", path)).toBeNull();
    },
  );
});

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:10.0.0.1",
    "fd00::1",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["93.184.215.14", "2606:4700::1111"])(
    "treats %s as public",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe("assertPublicUrl", () => {
  it("refuses a host that resolves to a private address", async () => {
    lookup.mockResolvedValueOnce([{ address: "10.0.0.7", family: 4 }]);

    await expect(
      assertPublicUrl("https://internal.example/media/a.webp"),
    ).rejects.toThrow("private address");
  });

  it.each([
    "http://localhost./a.webp",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
  ])("refuses %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow("Refusing to fetch");
  });
});

describe("fetchPublic", () => {
  it("checks a redirect's target before following it", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/secret" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchPublic("https://example.com/media/a.webp"),
    ).rejects.toThrow("private address");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
