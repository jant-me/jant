// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmView, VIEW_CONFIRM_DWELL_MS } from "../view-confirm.js";

function setToken(token = "payload.0123456789abcdef0123456789abcdef"): void {
  const meta = document.createElement("meta");
  meta.setAttribute("name", "jant-view");
  meta.setAttribute("content", token);
  document.head.appendChild(meta);
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("confirmView", () => {
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = "";
    delete document.documentElement.dataset.sitePathPrefix;
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "webdriver", {
      value: false,
      configurable: true,
    });
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("confirms once the page has been visible for five seconds", () => {
    setToken();
    confirmView();

    vi.advanceTimersByTime(VIEW_CONFIRM_DWELL_MS - 1);
    expect(beacon).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe("/_/seen");
    expect(body).toBeInstanceOf(Blob);
    expect(body.type).toBe("text/plain");

    // Once is all: neither more time nor an interaction sends again.
    vi.advanceTimersByTime(60_000);
    document.dispatchEvent(new Event("pointerdown"));
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("confirms at once on the first interaction", () => {
    setToken();
    confirmView();

    vi.advanceTimersByTime(300);
    document.dispatchEvent(new Event("scroll"));
    expect(beacon).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(VIEW_CONFIRM_DWELL_MS);
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("counts only the time the page is in front of the reader", () => {
    setToken();
    confirmView();

    vi.advanceTimersByTime(3_000);
    setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    expect(beacon).not.toHaveBeenCalled();

    setVisibility("visible");
    vi.advanceTimersByTime(1_999);
    expect(beacon).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("posts to the site's own prefix", () => {
    document.documentElement.dataset.sitePathPrefix = "/blog";
    setToken();
    confirmView();
    document.dispatchEvent(new Event("keydown"));
    expect(beacon.mock.calls[0]?.[0]).toBe("/blog/_/seen");
  });

  it("does nothing without a token, or under browser automation", () => {
    confirmView();
    vi.advanceTimersByTime(VIEW_CONFIRM_DWELL_MS);
    document.dispatchEvent(new Event("pointerdown"));
    expect(beacon).not.toHaveBeenCalled();

    setToken();
    Object.defineProperty(navigator, "webdriver", {
      value: true,
      configurable: true,
    });
    confirmView();
    vi.advanceTimersByTime(VIEW_CONFIRM_DWELL_MS);
    document.dispatchEvent(new Event("pointerdown"));
    expect(beacon).not.toHaveBeenCalled();
  });

  it("falls back to a keepalive fetch when the beacon is refused", () => {
    beacon.mockReturnValue(false);
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null)));
    vi.stubGlobal("fetch", fetchMock);
    setToken("tok.0123456789abcdef0123456789abcdef");
    confirmView();

    document.dispatchEvent(new Event("touchstart"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; keepalive: boolean; body: string },
    ];
    expect(url).toBe("/_/seen");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.body).toBe("tok.0123456789abcdef0123456789abcdef");
    vi.unstubAllGlobals();
  });
});
