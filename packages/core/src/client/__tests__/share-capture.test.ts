// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@zumer/snapdom", () => ({ snapdom: vi.fn() }));

const { snapdom } = await import("@zumer/snapdom");
const { __testOnly, prepareShareCard } = await import("../share-capture.js");
const { cutToScreen, paintPaperShadow, parseBoxShadow, MAX_CARD_HEIGHT } =
  __testOnly;

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

describe("parseBoxShadow", () => {
  it("reads the layers getComputedStyle writes, color first", () => {
    expect(
      parseBoxShadow(
        "rgba(0, 0, 0, 0.05) 0px 1px 2px 0px, rgba(0, 0, 0, 0.35) 0px 18px 40px -18px",
      ),
    ).toEqual([
      { x: 0, y: 1, blur: 2, spread: 0, color: "rgba(0, 0, 0, 0.05)" },
      { x: 0, y: 18, blur: 40, spread: -18, color: "rgba(0, 0, 0, 0.35)" },
    ]);
  });

  it("reads a layer written with its color last", () => {
    expect(parseBoxShadow("0 18px 40px -18px rgb(0 0 0 / 0.35)")).toEqual([
      { x: 0, y: 18, blur: 40, spread: -18, color: "rgb(0 0 0 / 0.35)" },
    ]);
  });

  it("has nothing to paint for none or an inset shadow", () => {
    expect(parseBoxShadow("none")).toEqual([]);
    expect(parseBoxShadow("rgb(0, 0, 0) 0px 0px 4px 0px inset")).toEqual([]);
  });
});

/** A 2D context that keeps what was asked of it. */
function recordingContext(width: number, height: number) {
  const fills: Array<{
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
    rect: number[];
  }> = [];
  const clips: string[] = [];
  let path: number[][] = [];
  const context = {
    canvas: { width, height },
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fillStyle: "",
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: () => {
      path = [];
    },
    rect: vi.fn(),
    moveTo: (x: number, y: number) => path.push([x, y]),
    arcTo: (x1: number, y1: number) => path.push([x1, y1]),
    closePath: vi.fn(),
    clip: (rule: string) => clips.push(rule),
    fill() {
      const xs = path.map(([x]) => x!);
      const ys = path.map(([, y]) => y!);
      fills.push({
        color: this.shadowColor,
        blur: this.shadowBlur,
        offsetX: this.shadowOffsetX,
        offsetY: this.shadowOffsetY,
        rect: [
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        ],
      });
    },
  };
  return { context, fills, clips };
}

describe("paintPaperShadow", () => {
  const shadow = {
    x: 34,
    y: 40,
    width: 472,
    height: 600,
    radius: 16,
    layers: [
      { x: 0, y: 1, blur: 2, spread: 0, color: "rgba(0, 0, 0, 0.05)" },
      { x: 0, y: 18, blur: 40, spread: -18, color: "rgba(0, 0, 0, 0.35)" },
    ],
  };

  it("casts each layer where CSS would, at the image's scale, the first on top", () => {
    const { context, fills } = recordingContext(1620, 2040);

    paintPaperShadow(context as unknown as CanvasRenderingContext2D, shadow, 3);

    expect(fills.map((fill) => fill.color)).toEqual([
      "rgba(0, 0, 0, 0.35)",
      "rgba(0, 0, 0, 0.05)",
    ]);
    const [deep, contact] = fills;
    // Blur and offsets scale; the shape sits off the canvas and its shadow
    // is moved back by the same distance.
    expect(deep!.blur).toBe(120);
    expect(deep!.offsetY).toBe(54);
    expect(deep!.rect[0]! + deep!.offsetX).toBeCloseTo((34 + 18) * 3);
    expect(deep!.rect[2]! + deep!.offsetX).toBeCloseTo((34 + 472 - 18) * 3);
    expect(deep!.rect[2]!).toBeLessThan(0);
    expect(contact!.blur).toBe(6);
    expect(contact!.rect[0]! + contact!.offsetX).toBeCloseTo(34 * 3);
  });

  it("keeps the shadow off the paper", () => {
    const { context, clips } = recordingContext(1620, 2040);

    paintPaperShadow(context as unknown as CanvasRenderingContext2D, shadow, 3);

    expect(clips).toEqual(["evenodd"]);
    expect(context.save).toHaveBeenCalled();
    expect(context.restore).toHaveBeenCalled();
  });
});

describe("capture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("paints with shadows off, then puts the paper's shadow back", async () => {
    // No fonts to wait for, and no `ready` for the capture to patch.
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: [],
    });
    vi.stubGlobal("FontFaceSet", class {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("share-card-paper")
          ? rect(40, 640)
          : rect(0, 720);
      },
    );
    const { context, fills } = recordingContext(1620, 2160);
    const canvas = Object.assign(context.canvas, {
      getContext: () => context,
      toBlob: (done: (blob: Blob) => void) => done(new Blob(["png"])),
    });
    let capturing: boolean | undefined;
    vi.mocked(snapdom).mockImplementation((async () => {
      capturing = document
        .querySelector(".share-card-host")
        ?.hasAttribute("data-capturing");
      return { toCanvas: async () => canvas };
    }) as unknown as typeof snapdom);

    const prepared = await prepareShareCard(
      '<div data-share-card data-file-name="hello"><div class="share-card-paper" style="border-radius: 16px; box-shadow: rgba(0, 0, 0, 0.35) 0px 18px 40px -18px"></div></div>',
    );
    const image = await prepared.capture();

    expect(capturing).toBe(true);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.color).toBe("rgba(0, 0, 0, 0.35)");
    expect(image.fileName).toBe("hello.png");
    expect(document.querySelector(".share-card-host")).toBeNull();
  });
});
