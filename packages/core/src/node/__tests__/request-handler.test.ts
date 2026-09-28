import { describe, expect, it } from "vitest";
import { withClientAddress } from "../request-handler.js";

function forged() {
  return new Request("http://blog.example/signin", {
    method: "POST",
    headers: {
      "X-Forwarded-For": "198.51.100.1",
      "CF-Connecting-IP": "198.51.100.2",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
}

describe("withClientAddress", () => {
  it("replaces client-sent address headers with the socket's address", async () => {
    const request = withClientAddress(forged(), "203.0.113.7", false);

    expect(request.headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(request.headers.get("cf-connecting-ip")).toBeNull();
    await expect(request.text()).resolves.toBe("{}");
  });

  it("drops them when the socket's address is unknown", () => {
    const request = withClientAddress(forged(), undefined, false);

    expect(request.headers.get("x-forwarded-for")).toBeNull();
  });

  it("keeps a trusted proxy's headers", () => {
    const request = withClientAddress(forged(), "10.0.0.2", true);

    expect(request.headers.get("x-forwarded-for")).toBe("198.51.100.1");
    expect(request.headers.get("cf-connecting-ip")).toBe("198.51.100.2");
  });
});
