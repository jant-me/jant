/**
 * Progressive Tufte-style footnote rail for wide public post views.
 *
 * Published HTML always remains a natural trailing endnote list. This module
 * only positions that existing list in the margin when the post's detail or
 * timeline container is wide enough and every note can be laid out safely. It
 * never clones or moves footnote content, so narrow, no-JS, print, reader, and
 * failure states retain the canonical endnote document order.
 */

const FOOTNOTE_BODY_SELECTOR = [
  '[data-post-view] [data-page="post"] [data-post-body].post-detail-body',
  "[data-timeline-item] article[data-post] > [data-post-body].prose",
].join(", ");
const FOOTNOTE_CONTAINER_SELECTOR = "[data-post-view], [data-timeline-item]";
const RAIL_ENABLED_PROPERTY = "--jant-footnote-rail-enabled";
const DEFAULT_NOTE_GAP_PX = 12;
const MAX_EXTRA_RAIL_HEIGHT_PX = 160;
const MAX_EXTRA_RAIL_HEIGHT_RATIO = 0.5;
const LAYOUT_EPSILON_PX = 0.5;

interface FootnoteRailItem {
  anchorTop: number;
  blockSize: number;
}

interface FootnoteRailLayout {
  offsets: number[];
  blockSize: number;
}

interface FootnotePair {
  reference: HTMLAnchorElement;
  note: globalThis.HTMLLIElement;
}

interface FootnoteStructure {
  section: HTMLElement;
  list: globalThis.HTMLOListElement;
  pairs: FootnotePair[];
}

interface RailController extends FootnoteStructure {
  body: HTMLElement;
  container: HTMLElement;
  observer: globalThis.ResizeObserver;
  abortController: AbortController;
  rafId: number;
  containerInlineSize: number | null;
  correctedInitialHash: boolean;
}

const controllers = new Map<HTMLElement, RailController>();
let printActive = false;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Place notes at their references while greedily preventing collisions.
 *
 * @param items - Reference offsets and measured note block sizes
 * @param gap - Minimum gap between adjacent notes in pixels
 * @returns Per-note offsets and the total rail block size
 */
function computeFootnoteRailLayout(
  items: FootnoteRailItem[],
  gap: number,
): FootnoteRailLayout {
  const safeGap = Math.max(0, finiteOr(gap, DEFAULT_NOTE_GAP_PX));
  const offsets: number[] = [];
  let previousBottom = 0;

  for (const [index, item] of items.entries()) {
    const anchorTop = Math.max(0, finiteOr(item.anchorTop, 0));
    const blockSize = Math.max(0, finiteOr(item.blockSize, 0));
    const offset =
      index === 0 ? anchorTop : Math.max(anchorTop, previousBottom + safeGap);

    offsets.push(offset);
    previousBottom = offset + blockSize;
  }

  return { offsets, blockSize: previousBottom };
}

function decodeFragment(href: string): string | null {
  if (!href.startsWith("#") || href.length === 1) return null;

  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return href.slice(1);
  }
}

function hasRole(element: globalThis.Element, role: string): boolean {
  return (element.getAttribute("role") ?? "").split(/\s+/).includes(role);
}

function findFootnoteStructure(body: HTMLElement): FootnoteStructure | null {
  const sections = Array.from(body.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      child.classList.contains("footnote-endnotes") &&
      hasRole(child, "doc-endnotes"),
  );
  if (sections.length !== 1) return null;

  const section = sections[0];
  if (!section) return null;

  const lists = Array.from(section.children).filter(
    (child): child is globalThis.HTMLOListElement =>
      child instanceof globalThis.HTMLOListElement &&
      child.classList.contains("footnote-list"),
  );
  if (lists.length !== 1) return null;

  const list = lists[0];
  if (!list) return null;

  const notes = Array.from(list.children).filter(
    (child): child is globalThis.HTMLLIElement =>
      child instanceof globalThis.HTMLLIElement &&
      child.classList.contains("footnote"),
  );
  if (notes.length === 0 || notes.length !== list.children.length) return null;

  const notesById = new Map<string, globalThis.HTMLLIElement>();
  for (const note of notes) {
    if (!note.id || notesById.has(note.id)) return null;
    if (document.getElementById(note.id) !== note) return null;
    notesById.set(note.id, note);
  }

  const firstReferencesByTarget = new Map<string, HTMLAnchorElement>();
  for (const reference of body.querySelectorAll<HTMLAnchorElement>(
    'a[role~="doc-noteref"][href^="#"]',
  )) {
    const targetId = decodeFragment(reference.getAttribute("href") ?? "");
    if (
      targetId &&
      notesById.has(targetId) &&
      !firstReferencesByTarget.has(targetId)
    ) {
      firstReferencesByTarget.set(targetId, reference);
    }
  }

  const pairs: FootnotePair[] = [];
  for (const note of notes) {
    const reference = firstReferencesByTarget.get(note.id);
    if (!reference) return null;
    pairs.push({ reference, note });
  }

  return { section, list, pairs };
}

function getObservedInlineSize(entry: globalThis.ResizeObserverEntry): number {
  const box = Array.isArray(entry.contentBoxSize)
    ? entry.contentBoxSize[0]
    : entry.contentBoxSize;
  return finiteOr(box?.inlineSize ?? entry.contentRect.width, 0);
}

function formatPixels(value: number): string {
  return `${Math.round(value * 1000) / 1000}px`;
}

function clearRuntimeLayout(controller: RailController): void {
  controller.body.classList.remove(
    "footnote-rail-measuring",
    "footnote-rail-ready",
  );
  controller.body.style.removeProperty("min-block-size");
  controller.list.style.removeProperty("--footnote-rail-block-size");

  for (const { note } of controller.pairs) {
    note.style.removeProperty("--footnote-rail-y");
    note.style.removeProperty("--footnote-rail-number");
  }
}

function setRuntimeNumbers(controller: RailController): void {
  let number = controller.list.start;

  for (const { note } of controller.pairs) {
    if (note.hasAttribute("value")) number = note.value;
    note.style.setProperty("--footnote-rail-number", `"${number}"`);
    number += 1;
  }
}

function getRailGap(list: globalThis.HTMLOListElement): number {
  const gap = Number.parseFloat(getComputedStyle(list).rowGap);
  return Number.isFinite(gap) ? gap : DEFAULT_NOTE_GAP_PX;
}

function railCanGrowTo(contentSize: number, railSize: number): boolean {
  const extra = Math.max(0, railSize - contentSize);
  const allowedExtra = Math.max(
    MAX_EXTRA_RAIL_HEIGHT_PX,
    contentSize * MAX_EXTRA_RAIL_HEIGHT_RATIO,
  );
  return extra <= allowedExtra + LAYOUT_EPSILON_PX;
}

function correctInitialHash(controller: RailController): void {
  if (controller.correctedInitialHash) return;
  controller.correctedInitialHash = true;

  const targetId = decodeFragment(globalThis.location.hash);
  if (!targetId) return;

  const target = controller.pairs.find(
    ({ note }) => note.id === targetId,
  )?.note;
  if (!target) return;

  requestAnimationFrame(() => {
    if (!controller.body.classList.contains("footnote-rail-ready")) return;
    target.scrollIntoView({ behavior: "auto", block: "nearest" });
  });
}

function isRailEnabled(body: HTMLElement): boolean {
  return (
    !printActive &&
    getComputedStyle(body).getPropertyValue(RAIL_ENABLED_PROPERTY).trim() ===
      "1"
  );
}

function layoutController(controller: RailController): void {
  if (!controller.body.isConnected) {
    destroyController(controller);
    return;
  }

  if (!isRailEnabled(controller.body)) {
    clearRuntimeLayout(controller);
    return;
  }

  clearRuntimeLayout(controller);
  controller.body.classList.add("footnote-rail-measuring");
  setRuntimeNumbers(controller);

  const bodyRect = controller.body.getBoundingClientRect();
  const contentBlockSize = Math.max(0, bodyRect.height);
  const items = controller.pairs.map(({ reference, note }) => ({
    anchorTop: reference.getBoundingClientRect().top - bodyRect.top,
    blockSize: note.getBoundingClientRect().height,
  }));

  if (items.some(({ blockSize }) => blockSize <= LAYOUT_EPSILON_PX)) {
    clearRuntimeLayout(controller);
    return;
  }

  const layout = computeFootnoteRailLayout(items, getRailGap(controller.list));
  if (!railCanGrowTo(contentBlockSize, layout.blockSize)) {
    clearRuntimeLayout(controller);
    return;
  }

  for (const [index, { note }] of controller.pairs.entries()) {
    note.style.setProperty(
      "--footnote-rail-y",
      formatPixels(layout.offsets[index] ?? 0),
    );
  }
  controller.list.style.setProperty(
    "--footnote-rail-block-size",
    formatPixels(layout.blockSize),
  );
  controller.body.style.setProperty(
    "min-block-size",
    formatPixels(Math.max(contentBlockSize, layout.blockSize)),
  );
  controller.body.classList.remove("footnote-rail-measuring");
  controller.body.classList.add("footnote-rail-ready");
  correctInitialHash(controller);
}

function scheduleController(controller: RailController): void {
  if (controller.rafId !== 0) return;

  controller.rafId = requestAnimationFrame(() => {
    controller.rafId = 0;
    layoutController(controller);
  });
}

function destroyController(controller: RailController): void {
  if (controller.rafId !== 0) cancelAnimationFrame(controller.rafId);
  controller.observer.disconnect();
  controller.abortController.abort();
  clearRuntimeLayout(controller);
  controllers.delete(controller.body);
}

function structuresMatch(
  controller: RailController,
  structure: FootnoteStructure,
): boolean {
  return (
    controller.section === structure.section &&
    controller.list === structure.list &&
    controller.pairs.length === structure.pairs.length &&
    controller.pairs.every(
      (pair, index) =>
        pair.note === structure.pairs[index]?.note &&
        pair.reference === structure.pairs[index]?.reference,
    )
  );
}

function createController(
  body: HTMLElement,
  structure: FootnoteStructure,
): RailController | null {
  if (!("ResizeObserver" in globalThis)) return null;

  const container = body.closest<HTMLElement>(FOOTNOTE_CONTAINER_SELECTOR);
  if (!container) return null;

  const abortController = new AbortController();
  const observer = new globalThis.ResizeObserver((entries) => {
    const controller = controllers.get(body);
    if (!controller) return;
    let needsLayout = false;

    for (const entry of entries) {
      if (entry.target === container) {
        const inlineSize = getObservedInlineSize(entry);
        if (
          controller.containerInlineSize === null ||
          Math.abs(controller.containerInlineSize - inlineSize) >
            LAYOUT_EPSILON_PX
        ) {
          controller.containerInlineSize = inlineSize;
          needsLayout = true;
        }
      } else {
        needsLayout = true;
      }
    }

    if (needsLayout) scheduleController(controller);
  });

  const controller: RailController = {
    body,
    container,
    ...structure,
    observer,
    abortController,
    rafId: 0,
    containerInlineSize: null,
    correctedInitialHash: false,
  };

  observer.observe(container);
  for (const child of body.children) {
    if (child !== structure.section) observer.observe(child);
  }

  for (const image of body.querySelectorAll("img")) {
    if (image.complete) continue;
    image.addEventListener("load", () => scheduleController(controller), {
      once: true,
      signal: abortController.signal,
    });
    image.addEventListener("error", () => scheduleController(controller), {
      once: true,
      signal: abortController.signal,
    });
  }

  controllers.set(body, controller);
  scheduleController(controller);
  return controller;
}

function collectFootnoteBodies(
  root: globalThis.Document | globalThis.Element,
): HTMLElement[] {
  const bodies: HTMLElement[] = [];
  if (
    root instanceof globalThis.Element &&
    root.matches(FOOTNOTE_BODY_SELECTOR)
  ) {
    bodies.push(root as HTMLElement);
  }
  bodies.push(...root.querySelectorAll<HTMLElement>(FOOTNOTE_BODY_SELECTOR));
  return bodies;
}

/**
 * Initialize or refresh progressive footnote rails inside a document fragment.
 *
 * @param root - Document or swapped fragment to scan
 * @returns Nothing
 */
export function initFootnoteRails(
  root: globalThis.Document | globalThis.Element = document,
): void {
  for (const controller of controllers.values()) {
    if (!controller.body.isConnected) destroyController(controller);
  }

  for (const body of collectFootnoteBodies(root)) {
    const structure = findFootnoteStructure(body);
    const existing = controllers.get(body);

    if (!structure) {
      if (existing) destroyController(existing);
      continue;
    }

    if (existing && structuresMatch(existing, structure)) {
      scheduleController(existing);
      continue;
    }

    if (existing) destroyController(existing);
    createController(body, structure);
  }
}

function scheduleAllControllers(): void {
  for (const controller of controllers.values()) scheduleController(controller);
}

globalThis.addEventListener("beforeprint", () => {
  printActive = true;
  for (const controller of controllers.values()) clearRuntimeLayout(controller);
});

globalThis.addEventListener("afterprint", () => {
  printActive = false;
  scheduleAllControllers();
});

if (document.fonts) {
  void document.fonts.ready.then(scheduleAllControllers);
  document.fonts.addEventListener("loadingdone", scheduleAllControllers);
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => initFootnoteRails(document),
    { once: true },
  );
} else {
  initFootnoteRails(document);
}

export const __testOnly = {
  computeFootnoteRailLayout,
  decodeFragment,
  findFootnoteStructure,
  railCanGrowTo,
  resetControllers(): void {
    for (const controller of [...controllers.values()]) {
      destroyController(controller);
    }
    printActive = false;
  },
  getControllerCount(): number {
    return controllers.size;
  },
};
