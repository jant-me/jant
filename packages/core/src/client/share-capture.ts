/**
 * Turns a share card into a PNG in the browser of whoever shares it.
 *
 * The server renders the card (`/_/share-card/{id}`); this lays it out off
 * screen with the page's own theme and fonts, waits for them, cuts the body
 * if the card is taller than one phone screen, and has snapdom paint it at
 * 3x, with the paper's shadow painted on the canvas afterwards. Two steps,
 * so the dialog can show the laid-out card while the picture is painted.
 */

import { snapdom } from "@zumer/snapdom";

/**
 * Tallest card, in CSS px: one 9:19.5 phone screen viewed at full width
 * (1620×3510 in the image).
 */
const MAX_CARD_HEIGHT = 1170;
/**
 * 540 CSS px at 3x is 1620 px: pixel for pixel on a 3x phone held upright,
 * where 2x (1080 px) was enlarged by a fifth and read soft. A chat that
 * shrinks the picture starts from a sharper one.
 */
const SCALE = 3;
/** Lines of a paragraph that may run under the fade at the cut. */
const FADE_MIN_LINES = 3;
/**
 * Blocks a cut may end between, wherever they sit: a list or a quotation is
 * cut between the paragraphs inside it, so a body that is one long list
 * still shows how it starts.
 */
const CUT_BLOCKS = "p, h1, h2, h3, h4, h5, h6, pre, table";
/** Blocks whose lines may run on under the fade. */
const RUN_ON_BLOCKS = new Set(["P", "PRE"]);
const FONTS_SETTLE_CAP_MS = 2_000;
/** How long one of snapdom's reads of `fonts.ready` may wait. */
const SNAPDOM_FONTS_CAP_MS = 1_000;
const CAPTURE_TIMEOUT_MS = 30_000;

export interface ShareImage {
  blob: Blob;
  width: number;
  height: number;
  fileName: string;
}

/** `promise`, or a rejection once `ms` have passed. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Creating the image took too long.")),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Resolves once no font face is loading, or after `ms`.
 *
 * Not `document.fonts.ready`: WebKit can leave the font set "loading" for
 * good while no face is loading at all, and `ready` then never settles. On a
 * Mac the trigger is text in a CJK serif stack with a character no local
 * font covers (an emoji): WebKit tries the Noto Serif SC face for U+20-5D
 * through its `local()` source, which fails without a request. On an iPhone
 * the set stuck with `local()` removed too, during snapdom's own font
 * warm-up. Faces that really are downloading are still waited for.
 */
function fontsSettled(ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const check = () => {
      const loading = Array.from(document.fonts).some(
        (face) => face.status === "loading",
      );
      if (!loading || Date.now() >= deadline) resolve();
      else setTimeout(check, 30);
    };
    // A frame for layout to start the loads the card needs.
    setTimeout(check, 16);
  });
}

/**
 * Run `fn` with every read of `document.fonts.ready` settling as soon as no
 * face is loading (see {@link fontsSettled}). On Safari snapdom awaits
 * `fonts.ready` before it captures, with no timeout; a stuck set would stop
 * the capture forever, and capping each read at a second cost an iPhone
 * about two seconds a picture. The patch lives only as long as `fn`.
 */
async function withSettledFontsReady<T>(fn: () => Promise<T>): Promise<T> {
  const prototype = globalThis.FontFaceSet.prototype;
  const real = Object.getOwnPropertyDescriptor(prototype, "ready");
  if (!real?.get) return fn();
  const read = real.get;
  Object.defineProperty(prototype, "ready", {
    configurable: true,
    get(this: globalThis.FontFaceSet) {
      const ready = read.call(this) as Promise<globalThis.FontFaceSet>;
      return Promise.race([
        ready.catch(() => this),
        fontsSettled(SNAPDOM_FONTS_CAP_MS),
      ]).then(() => this);
    },
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(prototype, "ready", real);
  }
}

function familyOf(face: globalThis.FontFace): string {
  return face.family.replace(/^["']|["']$/g, "");
}

/**
 * Web font families none of whose faces the page has loaded or is loading.
 *
 * A browser downloads a face only when no earlier font in the stack covers
 * the text, so these are declared but unused — on a Mac, Songti SC renders
 * what Noto Serif SC would. snapdom would embed them anyway, which took a
 * card from 180 KB to 2 MB and its capture from 80 to 350 ms.
 */
function unusedFontFamilies(): string[] {
  const used = new Set<string>();
  const declared = new Set<string>();
  for (const face of document.fonts) {
    const family = familyOf(face);
    declared.add(family);
    if (face.status === "loaded" || face.status === "loading") used.add(family);
  }
  return [...declared].filter((family) => !used.has(family));
}

/** Fonts the card uses, then every image in it, decoded. */
async function settle(card: HTMLElement): Promise<void> {
  void card.offsetHeight;
  await fontsSettled(FONTS_SETTLE_CAP_MS);
  await Promise.all(
    Array.from(card.querySelectorAll("img"), (image) =>
      image.decode().catch(() => {}),
    ),
  );
}

/**
 * Cut the body so the card fits one screen. The summary already decided the
 * text; this only steps in when the summary is still too tall, as a long
 * untitled note can be, or a titled one whose first block is a long list.
 * The cut lands between blocks ({@link CUT_BLOCKS}): a paragraph or code may
 * run on under a fade, but the card never ends on a heading.
 */
function cutToScreen(card: HTMLElement): void {
  const body = card.querySelector<HTMLElement>("[data-share-card-body]");
  if (!body) return;
  const overflow = card.offsetHeight - MAX_CARD_HEIGHT;
  if (overflow <= 0) return;

  const lineHeight = Number.parseFloat(getComputedStyle(body).lineHeight) || 30;
  const budget = body.offsetHeight - overflow;
  // When images or a long title take the screen, cutting the text away would
  // leave a card with nothing to read; let it run taller instead.
  if (budget < FADE_MIN_LINES * lineHeight) return;

  const bodyTop = body.getBoundingClientRect().top;
  const blocks = Array.from(body.querySelectorAll<HTMLElement>(CUT_BLOCKS))
    .filter((block) => !block.parentElement?.closest("pre, table"))
    .map((block) => {
      const rect = block.getBoundingClientRect();
      return {
        tagName: block.tagName,
        top: rect.top - bodyTop,
        bottom: rect.bottom - bodyTop,
      };
    })
    // Hidden ones, such as the footnotes, take no room.
    .filter((block) => block.bottom > block.top);
  const overflowing = blocks.findIndex((block) => block.bottom > budget);
  const visible = overflowing === -1 ? blocks : blocks.slice(0, overflowing);
  const next = overflowing === -1 ? undefined : blocks[overflowing];

  let cut: number;
  if (
    next &&
    RUN_ON_BLOCKS.has(next.tagName) &&
    budget - next.top >= FADE_MIN_LINES * lineHeight
  ) {
    cut = budget;
  } else {
    while (/^H[1-6]$/.test(visible.at(-1)?.tagName ?? "")) visible.pop();
    // A body that opens with a block taller than the screen shows its start.
    cut = visible.at(-1)?.bottom ?? budget;
  }

  body.classList.add("is-cut");
  body.style.maxHeight = `${Math.max(0, Math.floor(cut))}px`;
  const fade = document.createElement("div");
  fade.className = "share-card-fade";
  body.appendChild(fade);
}

/** One layer of a CSS `box-shadow`, lengths in CSS px. */
interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

/** `text` split on `separator` where it is not inside parentheses. */
function splitOutsideParens(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (depth === 0 && separator.test(char)) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * The outer layers of a `box-shadow` value, as `getComputedStyle` writes it
 * (color first, lengths in px) or as it is written in CSS (color anywhere).
 * Inset layers are dropped: they paint inside the box, which the capture
 * already holds.
 */
function parseBoxShadow(value: string): ShadowLayer[] {
  if (!value || value === "none") return [];
  return splitOutsideParens(value, /,/).flatMap((layer) => {
    const tokens = splitOutsideParens(layer, /\s/);
    if (tokens.includes("inset")) return [];
    const isLength = (token: string) => /^-?[\d.]+(px)?$/.test(token);
    const [x = 0, y = 0, blur = 0, spread = 0] = tokens
      .filter(isLength)
      .map((token) => Number.parseFloat(token));
    const color = tokens.find((token) => !isLength(token));
    return color ? [{ x, y, blur, spread, color }] : [];
  });
}

/** The paper's box on the card, in CSS px, and the shadow it casts. */
interface PaperShadow {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  layers: ShadowLayer[];
}

/** Read the paper's shadow while the page still draws it. */
function readPaperShadow(card: HTMLElement): PaperShadow | null {
  const paper = card.querySelector<HTMLElement>(".share-card-paper");
  if (!paper) return null;
  const style = getComputedStyle(paper);
  const layers = parseBoxShadow(style.boxShadow);
  if (layers.length === 0) return null;
  const cardBox = card.getBoundingClientRect();
  const box = paper.getBoundingClientRect();
  return {
    x: box.left - cardBox.left,
    y: box.top - cardBox.top,
    width: box.width,
    height: box.height,
    radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
    layers,
  };
}

/** A rounded rectangle's path; `roundRect` is newer than this needs. */
function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/**
 * Paint the paper's shadow onto the mat, outside the paper, as CSS paints an
 * outer box-shadow. The capture leaves shadows out (see the
 * `.share-card-host[data-capturing]` rule): in Safari snapdom draws any card
 * holding one at 1x and stretches it to the scale asked for. A canvas
 * shadow is sharp at any scale.
 *
 * Each layer is cast by a shape drawn off the canvas, its shadow offset back
 * into place, so only the shadow lands; the clip keeps it off the paper.
 */
function paintPaperShadow(
  context: CanvasRenderingContext2D,
  shadow: PaperShadow,
  scale: number,
): void {
  const { canvas } = context;
  const away = canvas.width + (shadow.width + 200) * scale;
  context.save();
  context.beginPath();
  context.rect(0, 0, canvas.width, canvas.height);
  roundedRectPath(
    context,
    shadow.x * scale,
    shadow.y * scale,
    shadow.width * scale,
    shadow.height * scale,
    shadow.radius * scale,
  );
  context.clip("evenodd");
  // CSS paints the first layer on top.
  for (const layer of [...shadow.layers].reverse()) {
    context.shadowColor = layer.color;
    // Both are twice the Gaussian's standard deviation.
    context.shadowBlur = layer.blur * scale;
    context.shadowOffsetX = layer.x * scale + away;
    context.shadowOffsetY = layer.y * scale;
    context.fillStyle = "#000";
    context.beginPath();
    roundedRectPath(
      context,
      (shadow.x - layer.spread) * scale - away,
      (shadow.y - layer.spread) * scale,
      (shadow.width + layer.spread * 2) * scale,
      (shadow.height + layer.spread * 2) * scale,
      Math.max(0, shadow.radius + layer.spread) * scale,
    );
    context.fill();
  }
  context.restore();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("The image came out empty.")),
      "image/png",
    );
  });
}

export interface PreparedShareCard {
  /** The card as it will be painted — fonts in, cut to one screen. */
  html: string;
  /** Its size in CSS px; the image is {@link SCALE} times this. */
  width: number;
  height: number;
  /** Paint it. Removes the off-screen card whether or not it succeeds. */
  capture(): Promise<ShareImage>;
  /** Remove the off-screen card without painting it. */
  dispose(): void;
}

/**
 * Lay out a server-rendered share card off screen, ready to paint: fonts
 * and images loaded, the body cut to one screen.
 *
 * @param cardHtml - Markup from `/_/share-card/{id}`
 * @returns The laid-out card's markup and the step that paints it
 */
export async function prepareShareCard(
  cardHtml: string,
): Promise<PreparedShareCard> {
  const host = document.createElement("div");
  host.className = "share-card-host";
  host.setAttribute("aria-hidden", "true");
  host.innerHTML = cardHtml;
  document.body.appendChild(host);
  const dispose = () => host.remove();
  try {
    const card = host.querySelector<HTMLElement>("[data-share-card]");
    if (!card) throw new Error("The share card is missing.");
    await settle(card);
    const excludedFamilies = unusedFontFamilies();
    cutToScreen(card);
    return {
      html: card.outerHTML,
      width: card.offsetWidth,
      height: card.offsetHeight,
      dispose,
      async capture() {
        try {
          const paperShadow = readPaperShadow(card);
          host.dataset.capturing = "";
          const canvas = await withTimeout(
            withSettledFontsReady(async () => {
              const capture = await snapdom(card, {
                scale: SCALE,
                dpr: 1,
                reconcile: true,
                excludeFonts: { families: excludedFamilies },
              });
              return capture.toCanvas();
            }),
            CAPTURE_TIMEOUT_MS,
          );
          const context = canvas.getContext("2d");
          if (paperShadow && context) {
            paintPaperShadow(context, paperShadow, SCALE);
          }
          const blob = await canvasToBlob(canvas);
          const { width, height } = canvas;
          canvas.width = 0;
          canvas.height = 0;
          return {
            blob,
            width,
            height,
            fileName: `${card.dataset.fileName || "post"}.png`,
          };
        } finally {
          dispose();
        }
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export const __testOnly = {
  cutToScreen,
  paintPaperShadow,
  parseBoxShadow,
  MAX_CARD_HEIGHT,
};
