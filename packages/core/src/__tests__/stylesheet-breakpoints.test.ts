import { describe, expect, it } from "vitest";
import { readAllStylesheets } from "./helpers/component-css.js";

/**
 * The sanctioned width breakpoints, mirroring the ledger comment in
 * `styles/tokens.css`. Each number is one job; a job never gets a second
 * number.
 *
 * This is not bookkeeping for its own sake. The composer once switched to its
 * full-screen sheet at 700px while its own controls took their touch sizing at
 * 760px, so a 750px window rendered a thumb-sized Post button (46px, against
 * 33px one pixel wider) inside a windowed dialog. Nothing was wrong in either
 * rule on its own — they had simply drifted to two numbers for one switch, and
 * no test could see it.
 */
const LEDGER = [
  480, // Header hamburger; the composer's post-meta pill sheds its words.
  580, // Nav collapse tier-sm.
  640, // Media grid and lightbox chrome.
  700, // The phone switch.
  780, // Nav collapse tier-md.
  960, // Nav collapse tier-lg.
  1024, // Tufte two-column → single-column.
  1079, // Collections sidebar drops out.
  1200, // Header search collapses to an icon.
] as const;

/**
 * Height breakpoints are a separate axis with a separate job: a short viewport
 * has no room for the composer's chrome regardless of how wide it is. One
 * number, stated on both sides.
 */
const HEIGHT_LEDGER = [760] as const;

interface Condition {
  /** The stylesheet the condition appears in. */
  file: string;
  /** 1-indexed line of the `@media` prelude the condition sits in. */
  line: number;
  /** `min` or `max`. */
  bound: "min" | "max";
  /** `width` or `height`. */
  axis: "width" | "height";
  /** The pixel value as written. */
  value: number;
  /** The condition as written, for failure messages. */
  text: string;
}

/**
 * Every `(min-width: …)` / `(max-width: …)` / `(min-height: …)` /
 * `(max-height: …)` condition in an `@media` prelude across the hand-written
 * stylesheets.
 *
 * `@media` only. A `@container` query carrying the same words measures its
 * container, not the viewport, so it answers to the component it wraps rather
 * than to this ledger — the archive filter bar splits on its own inline size
 * at 39rem and is right to.
 *
 * A prelude may span several lines (the composer's full-screen sheet lists
 * three conditions), so the line number is counted to the condition itself
 * rather than to the `@media` that opens it.
 */
function collectConditions(): Condition[] {
  const found: Condition[] = [];

  for (const { name, css } of readAllStylesheets()) {
    const preludes = /@media\b([^{;]*)/g;
    let prelude: RegExpExecArray | null;

    while ((prelude = preludes.exec(css)) !== null) {
      const offset = prelude.index + "@media".length;
      const pattern = /\((min|max)-(width|height):\s*([^)]+)\)/g;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(prelude[1])) !== null) {
        const [text, bound, axis, raw] = match;
        const px = /^(\d+(?:\.\d+)?)px$/.exec(raw.trim());

        found.push({
          file: name,
          line: css.slice(0, offset + match.index).split("\n").length,
          bound: bound as "min" | "max",
          axis: axis as "width" | "height",
          // A non-px unit lands as NaN and fails the ledger check by name,
          // which is the point: `rem` in a media query resolves against the
          // initial font-size rather than the root this document sets, so the
          // number it reads as is not the number it is.
          value: px ? Number(px[1]) : Number.NaN,
          text,
        });
      }
    }
  }

  return found;
}

/**
 * The breakpoint a condition belongs to. `min-width: 700px` and
 * `max-width: 699px` are the two sides of the same 700px switch, so the `max`
 * side is stated one pixel below the number it divides on.
 */
function breakpointOf(condition: Condition): number {
  return condition.bound === "max" ? condition.value + 1 : condition.value;
}

describe("stylesheet breakpoints", () => {
  it("uses only the breakpoints on the ledger", () => {
    const strays = collectConditions()
      .filter((condition) => {
        const ledger = condition.axis === "width" ? LEDGER : HEIGHT_LEDGER;
        // Both spellings of a breakpoint are accepted here — `max-width: 640px`
        // and `max-width: 639px` are the same switch. Which one a file may use
        // is settled by the overlap test below.
        return !(
          ledger.includes(condition.value as never) ||
          ledger.includes(breakpointOf(condition) as never)
        );
      })
      .map(
        (condition) =>
          `${condition.file}:${condition.line} ${condition.text}` +
          ` — not on the ledger in styles/tokens.css`,
      );

    expect(strays).toEqual([]);
  });

  it("never lets both sides of a breakpoint match the same viewport", () => {
    const conditions = collectConditions();
    const overlaps: string[] = [];

    for (const axis of ["width", "height"] as const) {
      const onAxis = conditions.filter((condition) => condition.axis === axis);

      for (const value of new Set(
        onAxis.filter((c) => c.bound === "min").map((c) => c.value),
      )) {
        // `min-*: N` and `max-*: N` both match at exactly N. Wherever a
        // breakpoint is written from both sides, the lower side has to sit one
        // pixel below it — otherwise a viewport of exactly N gets the phone
        // layout and the desktop spacing at once.
        const clash = onAxis.filter(
          (condition) => condition.bound === "max" && condition.value === value,
        );

        overlaps.push(
          ...clash.map(
            (condition) =>
              `${condition.file}:${condition.line} ${condition.text}` +
              ` overlaps (min-${axis}: ${value}px) at exactly ${value}px` +
              ` — write it as (max-${axis}: ${value - 1}px)`,
          ),
        );
      }
    }

    expect(overlaps).toEqual([]);
  });

  it("keeps the phone switch on one number", () => {
    // The regression this file exists for. Touch sizing and the mobile type
    // scale used to ride on 760px while the layout they sit inside switched at
    // 700px; anything between the two was a desktop window wearing phone
    // controls. Any width breakpoint in the 700s that is not the nav ladder's
    // 780px is that drift coming back.
    const nearMisses = collectConditions()
      .filter(
        (condition) =>
          condition.axis === "width" &&
          condition.value > 700 &&
          condition.value < 780,
      )
      .map(
        (condition) =>
          `${condition.file}:${condition.line} ${condition.text}` +
          ` — the phone switch is 700px; see the ledger in styles/tokens.css`,
      );

    expect(nearMisses).toEqual([]);
  });
});
