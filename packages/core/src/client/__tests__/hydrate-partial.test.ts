// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

// Stub the initializer modules so importing hydrate-partial doesn't run their
// module-load side effects (DOMContentLoaded registration, observers), and so we
// can assert hydratePartial forwards the root to each one.
vi.mock("../thread-context.js", () => ({ setupThreadContexts: vi.fn() }));
vi.mock("../feed-video-player.js", () => ({ initFeedVideoPlayer: vi.fn() }));
vi.mock("../audio-player.js", () => ({ initPrecomputedWaveforms: vi.fn() }));
vi.mock("../footnote-rail.js", () => ({ initFootnoteRails: vi.fn() }));

import { hydratePartial } from "../hydrate-partial.js";
import { setupThreadContexts } from "../thread-context.js";
import { initFeedVideoPlayer } from "../feed-video-player.js";
import { initPrecomputedWaveforms } from "../audio-player.js";
import { initFootnoteRails } from "../footnote-rail.js";

describe("hydratePartial", () => {
  it("re-initializes per-element behaviors scoped to the swapped root", () => {
    const root = document.createElement("div");

    hydratePartial(root);

    expect(setupThreadContexts).toHaveBeenCalledWith(root);
    expect(initFeedVideoPlayer).toHaveBeenCalledWith(root);
    expect(initPrecomputedWaveforms).toHaveBeenCalledWith(root);
    expect(initFootnoteRails).toHaveBeenCalledWith(root);
  });
});
