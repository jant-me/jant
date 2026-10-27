// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@zumer/snapdom", () => ({ snapdom: vi.fn() }));

const { __testOnly } = await import("../share-capture.js");
const { cutToScreen, MAX_CARD_HEIGHT } = __testOnly;

const LINE_HEIGHT = 30;
/** The body is 900 px and the card 300 px too tall: 600 px of body fit. */
const BODY_HEIGHT = 900;
const OVERFLOW = 300;

function rect(top: number, bottom: number): globalThis.DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 540,
    width: 540,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

/**
 * Lay out a card whose body holds `html`, with each block the cut measures
 * given its `[top, bottom]` in document order.
 */
function layout(
  html: string,
  blocks: Array<[number, number]>,
  overflow = OVERFLOW,
): HTMLElement {
  document.body.innerHTML = `<div data-share-card><div data-share-card-body style="line-height: ${LINE_HEIGHT}px">${html}</div></div>`;
  const card = document.querySelector<HTMLElement>("[data-share-card]")!;
  const body = card.querySelector<HTMLElement>("[data-share-card-body]")!;
  Object.defineProperty(card, "offsetHeight", {
    value: MAX_CARD_HEIGHT + overflow,
  });
  Object.defineProperty(body, "offsetHeight", { value: BODY_HEIGHT });
  body.getBoundingClientRect = () => rect(0, BODY_HEIGHT);
  const measured = body.querySelectorAll<HTMLElement>(
    "p, h1, h2, h3, h4, h5, h6, pre, table",
  );
  expect(measured).toHaveLength(blocks.length);
  measured.forEach((block, index) => {
    const [top, bottom] = blocks[index]!;
    block.getBoundingClientRect = () => rect(top, bottom);
  });
  return card;
}

function cutHeight(card: HTMLElement): string {
  const body = card.querySelector<HTMLElement>("[data-share-card-body]")!;
  return body.style.maxHeight;
}

const LIST = `<ul>
  <li><p>a</p><ul><li><p>b</p></li><li><p>c</p></li></ul></li>
  <li><p>d</p></li>
</ul>`;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("cutToScreen", () => {
  it("leaves a card that fits one screen alone", () => {
    const card = layout("<p>a</p>", [[0, 60]], 0);
    cutToScreen(card);
    expect(cutHeight(card)).toBe("");
    expect(card.querySelector(".share-card-fade")).toBeNull();
  });

  it("cuts a body that is one long list between the paragraphs in it", () => {
    const card = layout(LIST, [
      [0, 60],
      [70, 130],
      [140, 560],
      // Two lines of "d" would fit: too few to run on under the fade.
      [570, 900],
    ]);
    cutToScreen(card);
    expect(cutHeight(card)).toBe("560px");
    expect(card.querySelector(".share-card-fade")).not.toBeNull();
  });

  it("runs a paragraph in a list on under the fade", () => {
    const card = layout(LIST, [
      [0, 60],
      [70, 130],
      [140, 400],
      [410, 900],
    ]);
    cutToScreen(card);
    expect(cutHeight(card)).toBe("600px");
  });

  it("never ends on a heading", () => {
    const card = layout(
      "<p>a</p><h2>Heading</h2><table><tr><td>x</td></tr></table>",
      [
        [0, 300],
        [320, 360],
        [380, 900],
      ],
    );
    cutToScreen(card);
    expect(cutHeight(card)).toBe("300px");
  });

  it("shows the start of a body that opens with a block taller than the screen", () => {
    const card = layout("<table><tr><td>x</td></tr></table>", [[0, 1500]]);
    cutToScreen(card);
    expect(cutHeight(card)).toBe("600px");
  });

  it("skips blocks that take no room, such as hidden footnotes", () => {
    const card = layout(
      '<p>a</p><p>b</p><section class="footnote-endnotes"><ol><li><p>note</p></li></ol></section>',
      [
        [0, 300],
        [310, 580],
        [0, 0],
      ],
    );
    cutToScreen(card);
    expect(cutHeight(card)).toBe("580px");
  });
});
