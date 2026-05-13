// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "../jant-media-lightbox.js";
import type { JantMediaLightbox } from "../jant-media-lightbox.js";
import { shouldUseScrollableLightboxImage } from "../jant-media-lightbox.js";

function installDialogShim() {
  Object.defineProperty(HTMLDialogElement.prototype, "open", {
    configurable: true,
    get(this: HTMLDialogElement) {
      return this.hasAttribute("open");
    },
    set(this: HTMLDialogElement, value: boolean) {
      if (value) {
        this.setAttribute("open", "");
      } else {
        this.removeAttribute("open");
      }
    },
  });

  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });

  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
}

function installMediaShim() {
  Object.defineProperty(globalThis.HTMLMediaElement.prototype, "play", {
    configurable: true,
    value() {
      return Promise.resolve();
    },
  });

  Object.defineProperty(globalThis.HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value() {},
  });
}

function setViewport(width: number, height: number) {
  Object.defineProperty(globalThis, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(globalThis, "innerHeight", {
    configurable: true,
    value: height,
  });
}

async function flush(el?: JantMediaLightbox) {
  await Promise.resolve();
  await Promise.resolve();
  if (el) await el.updateComplete;
}

async function createElement(): Promise<JantMediaLightbox> {
  const el = document.createElement("jant-media-lightbox") as JantMediaLightbox;
  document.body.appendChild(el);
  await flush(el);
  return el;
}

describe("JantMediaLightbox", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    installDialogShim();
    installMediaShim();
    setViewport(1280, 800);
  });

  it("marks very tall images as scrollable when contain mode would be too narrow", () => {
    expect(
      shouldUseScrollableLightboxImage({ width: 800, height: 2400 }, 1280, 800),
    ).toBe(true);
  });

  it("keeps standard images in contain mode", () => {
    expect(
      shouldUseScrollableLightboxImage({ width: 1600, height: 900 }, 1280, 800),
    ).toBe(false);
  });

  it("renders tall images in a scrollable stage", async () => {
    const el = await createElement();

    el.open(
      [
        {
          url: "https://example.com/tall.jpg",
          alt: "",
          width: 800,
          height: 2400,
        },
      ],
      0,
    );
    await flush(el);

    const stage = el.querySelector(".media-lightbox-stage");
    const img = el.querySelector(".media-lightbox-img");

    expect(stage?.classList.contains("media-lightbox-stage-scroll")).toBe(true);
    expect(img?.classList.contains("media-lightbox-img-scroll")).toBe(true);
  });

  it("resets stage scroll when navigating between images", async () => {
    const el = await createElement();

    el.open(
      [
        {
          url: "https://example.com/tall-1.jpg",
          alt: "",
          width: 800,
          height: 2400,
        },
        {
          url: "https://example.com/tall-2.jpg",
          alt: "",
          width: 800,
          height: 2400,
        },
      ],
      0,
    );
    await flush(el);

    const initialStage = el.querySelector<HTMLElement>(".media-lightbox-stage");
    if (!initialStage) {
      throw new Error("expected lightbox stage");
    }
    initialStage.scrollTop = 180;

    el.querySelector<HTMLButtonElement>(".media-lightbox-nav-next")?.click();
    await flush(el);

    const nextStage = el.querySelector<HTMLElement>(".media-lightbox-stage");
    expect(nextStage?.scrollTop).toBe(0);
  });

  it("uses natural image dimensions for inline post-body images", async () => {
    const el = await createElement();
    const container = document.createElement("div");
    container.setAttribute("data-post-body", "");

    const img = document.createElement("img");
    img.src = "https://example.com/inline-tall.jpg";
    img.alt = "Tall inline image";
    Object.defineProperty(img, "naturalWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(img, "naturalHeight", {
      configurable: true,
      value: 2400,
    });
    container.appendChild(img);
    document.body.appendChild(container);

    img.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }),
    );
    await flush(el);

    const stage = el.querySelector(".media-lightbox-stage");
    expect(stage?.classList.contains("media-lightbox-stage-scroll")).toBe(true);
  });

  it("renders custom controls for short videos", async () => {
    const el = await createElement();

    el.open(
      [
        {
          url: "https://example.com/clip.mp4",
          alt: "",
          mimeType: "video/mp4",
          durationSeconds: 12,
          size: 2_000_000,
        },
      ],
      0,
    );
    await flush(el);

    const video = el.querySelector<HTMLVideoElement>(".media-lightbox-video");
    const progress = el.querySelector<HTMLInputElement>(
      ".media-lightbox-short-progress",
    );
    const muteButton = el.querySelector<HTMLButtonElement>(
      ".media-lightbox-short-mute",
    );

    expect(video?.hasAttribute("controls")).toBe(false);
    expect(progress).not.toBeNull();
    expect(muteButton).not.toBeNull();
  });

  it("scrubs the video on arrow keys instead of switching items", async () => {
    const el = await createElement();

    el.open(
      [
        {
          url: "https://example.com/clip-a.mp4",
          alt: "",
          mimeType: "video/mp4",
          durationSeconds: 45,
          size: 2_000_000,
        },
        {
          url: "https://example.com/clip-b.mp4",
          alt: "",
          mimeType: "video/mp4",
          durationSeconds: 45,
          size: 2_000_000,
        },
      ],
      0,
    );
    await flush(el);

    const dialog = el.querySelector<HTMLDialogElement>(".media-lightbox");
    const video = el.querySelector<HTMLVideoElement>(".media-lightbox-video");
    if (!dialog || !video) throw new Error("expected dialog and video");

    Object.defineProperty(video, "duration", { configurable: true, value: 45 });
    video.currentTime = 10;

    dialog.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flush(el);

    expect(video.currentTime).toBeCloseTo(15);
    expect(el.querySelector(".media-lightbox-counter")?.textContent).toMatch(
      /1\s*\/\s*2/,
    );

    dialog.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flush(el);

    expect(video.currentTime).toBeCloseTo(10);
    expect(el.querySelector(".media-lightbox-counter")?.textContent).toMatch(
      /1\s*\/\s*2/,
    );
  });

  it("switches items on arrow keys for images", async () => {
    const el = await createElement();

    el.open(
      [
        { url: "https://example.com/a.jpg", alt: "" },
        { url: "https://example.com/b.jpg", alt: "" },
      ],
      0,
    );
    await flush(el);

    const dialog = el.querySelector<HTMLDialogElement>(".media-lightbox");
    if (!dialog) throw new Error("expected dialog");

    dialog.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flush(el);

    expect(el.querySelector(".media-lightbox-counter")?.textContent).toMatch(
      /2\s*\/\s*2/,
    );
  });

  it("keeps native controls for long videos", async () => {
    const el = await createElement();

    el.open(
      [
        {
          url: "https://example.com/long.mp4",
          alt: "",
          mimeType: "video/mp4",
          durationSeconds: 45,
          size: 2_000_000,
        },
      ],
      0,
    );
    await flush(el);

    const video = el.querySelector<HTMLVideoElement>(".media-lightbox-video");
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(el.querySelector(".media-lightbox-short-controls")).toBeNull();
  });
});
