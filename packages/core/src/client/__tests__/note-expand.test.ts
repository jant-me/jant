// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "../note-expand.js";

interface CardOptions {
  clamped?: boolean;
  withMarker?: boolean;
}

function buildCard(options: CardOptions = {}) {
  const { clamped = true, withMarker = true } = options;

  const article = document.createElement("article");
  article.setAttribute("data-post", "");

  const body = document.createElement("div");
  body.setAttribute("data-post-body", "");
  if (clamped) body.setAttribute("data-note-clamp", "");
  body.innerHTML = withMarker
    ? "<p>Summary</p><span data-note-break></span><p>Rest</p>"
    : "<p>Summary</p>";

  const control = document.createElement("a");
  control.setAttribute("data-note-expand", "");
  control.setAttribute("aria-expanded", "false");
  control.setAttribute("href", "/post-1");
  control.dataset.labelMore = "Read more";
  control.dataset.labelLess = "Read less";
  control.textContent = "Read more";

  article.appendChild(body);
  article.appendChild(control);
  document.body.appendChild(article);
  return { article, body, control };
}

/** Dispatch a click; returns false when a handler called preventDefault. */
function click(
  el: HTMLElement,
  init: { metaKey?: boolean; button?: number } = {},
): boolean {
  return el.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, ...init }),
  );
}

describe("note expand", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("reveals the tail by removing the clamp on expand", () => {
    const { body, control } = buildCard();

    const notCancelled = click(control);

    expect(notCancelled).toBe(false);
    expect(body.hasAttribute("data-note-clamp")).toBe(false);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(control.textContent).toBe("Read less");
  });

  it("re-clamps the tail on collapse", () => {
    const { body, control } = buildCard();

    click(control);
    click(control);

    expect(body.hasAttribute("data-note-clamp")).toBe(true);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(control.textContent).toBe("Read more");
  });

  it("ignores modified clicks so the link opens normally", () => {
    const { body, control } = buildCard();

    const notCancelled = click(control, { metaKey: true });

    expect(notCancelled).toBe(true);
    expect(body.hasAttribute("data-note-clamp")).toBe(true);
  });

  it("leaves the link alone when the body has no break marker", () => {
    const { body, control } = buildCard({ clamped: false, withMarker: false });

    const notCancelled = click(control);

    expect(notCancelled).toBe(true);
    expect(body.hasAttribute("data-note-clamp")).toBe(false);
  });

  it("only toggles the clicked card", () => {
    const a = buildCard();
    const b = buildCard();

    click(a.control);

    expect(a.body.hasAttribute("data-note-clamp")).toBe(false);
    expect(b.body.hasAttribute("data-note-clamp")).toBe(true);
  });

  it("scrolls the note top into view on collapse when scrolled past it", () => {
    const { article, control } = buildCard();
    click(control); // expand

    const scrollIntoView = vi.fn();
    article.scrollIntoView = scrollIntoView;
    vi.spyOn(article, "getBoundingClientRect").mockReturnValue({
      top: -50,
    } as unknown as ReturnType<HTMLElement["getBoundingClientRect"]>);

    click(control); // collapse

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("keeps working after the card DOM is replaced", () => {
    buildCard();

    // Simulate compose-bridge replacing the card with a fresh collapsed render.
    document.body.innerHTML = "";
    const { body, control } = buildCard();

    click(control);

    expect(body.hasAttribute("data-note-clamp")).toBe(false);
  });

  it("expands and re-clamps when data-note-break is nested inside a list", () => {
    const { body, control } = buildCard();
    body.innerHTML =
      "<ul><li><p>First</p></li><span data-note-break></span><li><p>Second</p></li></ul><p>Trailing</p>";

    // HTML parser keeps the marker inside <ul> between the two <li> elements,
    // and CSS `:is([data-note-break], :has([data-note-break])) ~ *` matches
    // both the remaining <li> and the trailing <p> outside <ul>.
    const hiddenByRule = [
      ...document.querySelectorAll(
        "[data-note-clamp] :is([data-note-break], :has([data-note-break])) ~ *",
      ),
    ]
      .map((el) => `${el.tagName}:${el.textContent}`)
      .sort();
    expect(hiddenByRule).toEqual(["LI:Second", "P:Trailing"]);

    click(control);
    expect(body.hasAttribute("data-note-clamp")).toBe(false);
    expect(control.textContent).toBe("Read less");

    click(control);
    expect(body.hasAttribute("data-note-clamp")).toBe(true);
    expect(control.textContent).toBe("Read more");
  });
});
