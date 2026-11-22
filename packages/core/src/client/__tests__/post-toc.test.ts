// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { initPostToc } from "../post-toc.js";

function renderTocDom(): void {
  document.body.innerHTML = `
    <div data-post-view>
      <nav class="post-toc" data-post-toc>
        <button type="button" data-post-toc-trigger aria-expanded="false">
          <span class="post-toc-ticks" aria-hidden="true">
            <span class="post-toc-tick" data-post-toc-tick="section-one"></span>
            <span class="post-toc-tick" data-post-toc-tick="section-two"></span>
            <span class="post-toc-tick" data-post-toc-tick="section-three"></span>
          </span>
        </button>
        <div class="post-toc-panel" data-post-toc-panel>
          <ol>
            <li><a href="#section-one" data-post-toc-link="section-one">One</a></li>
            <li><a href="#section-two" data-post-toc-link="section-two">Two</a></li>
            <li><a href="#section-three" data-post-toc-link="section-three">Three</a></li>
          </ol>
        </div>
      </nav>
      <article class="post-detail">
        <div data-post-body>
          <h2 id="section-one" tabindex="-1" data-post-heading>
            One
            <a class="heading-anchor" href="#section-one" data-heading-anchor>#</a>
          </h2>
          <h2 id="section-two" tabindex="-1" data-post-heading>Two</h2>
          <h2 id="section-three" tabindex="-1" data-post-heading>Three</h2>
        </div>
      </article>
    </div>
  `;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("post-toc client interactions", () => {
  it("dismisses on Escape, outside click, peer popover, and section selection", () => {
    renderTocDom();
    initPostToc(document);

    const toc = document.querySelector<HTMLElement>("[data-post-toc]")!;
    const button = document.querySelector<HTMLButtonElement>(
      "[data-post-toc-trigger]",
    )!;
    const link = document.querySelector<HTMLAnchorElement>(
      '[data-post-toc-link="section-two"]',
    )!;
    const heading = document.getElementById("section-two")!;

    expect(toc.hasAttribute("data-ready")).toBe(true);
    expect(toc.hasAttribute("data-toc-active")).toBe(true);

    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(toc.hasAttribute("data-open")).toBe(true);

    link.focus();
    link.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);

    button.click();
    heading.click();
    expect(button.getAttribute("aria-expanded")).toBe("false");

    button.click();
    document.dispatchEvent(
      new CustomEvent("basecoat:popover", {
        detail: { source: document.createElement("div") },
      }),
    );
    expect(button.getAttribute("aria-expanded")).toBe("false");

    button.click();
    link.click();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(heading);
  });

  it("opens on pointerenter and closes after delay on pointerleave in desktop hover mode", () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "matchMedia").mockImplementation(
      () => ({ matches: false }) as globalThis.MediaQueryList,
    );

    renderTocDom();
    initPostToc(document);

    const toc = document.querySelector<HTMLElement>("[data-post-toc]")!;
    const button = document.querySelector<HTMLButtonElement>(
      "[data-post-toc-trigger]",
    )!;

    toc.dispatchEvent(
      new PointerEvent("pointerenter", { pointerType: "mouse" }),
    );
    expect(toc.hasAttribute("data-open")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    toc.dispatchEvent(
      new PointerEvent("pointerleave", { pointerType: "mouse" }),
    );
    expect(toc.hasAttribute("data-open")).toBe(true);

    vi.advanceTimersByTime(220);
    expect(toc.hasAttribute("data-open")).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays inactive when a post fits within one viewport", () => {
    renderTocDom();
    vi.spyOn(globalThis, "innerHeight", "get").mockReturnValue(900);
    const body = document.querySelector<HTMLElement>("[data-post-body]")!;
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue({
      height: 500,
    } as globalThis.DOMRect);
    vi.spyOn(document.scrollingElement!, "scrollHeight", "get").mockReturnValue(
      700,
    );

    initPostToc(document);

    const toc = document.querySelector<HTMLElement>("[data-post-toc]")!;
    expect(toc.hasAttribute("data-toc-active")).toBe(false);
  });

  it("copies the section URL and marks heading anchor as copied on click", () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderTocDom();
    initPostToc(document);

    const anchor = document.querySelector<HTMLAnchorElement>(
      "[data-heading-anchor]",
    )!;
    anchor.click();

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("#section-one"),
    );
    expect(anchor.hasAttribute("data-copied")).toBe(true);

    vi.advanceTimersByTime(1700);
    expect(anchor.hasAttribute("data-copied")).toBe(false);
  });
});
