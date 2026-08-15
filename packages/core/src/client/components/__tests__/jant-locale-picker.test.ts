// @vitest-environment happy-dom

import { describe, it, expect, afterEach } from "vitest";

import "../jant-locale-picker.js";
import type { JantLocalePicker } from "../jant-locale-picker.js";

const locales = [
  { tag: "en", native: "English", english: "English", coverage: 1 },
  {
    tag: "zh-Hans",
    native: "简体中文",
    english: "Simplified Chinese",
    coverage: 1,
  },
  { tag: "ja", native: "日本語", english: "Japanese", coverage: 0 },
  { tag: "fi", native: "suomi", english: "Finnish", coverage: 0 },
];

const labels = { search: "Search…", empty: "No matches." };

async function createPicker(options?: {
  value?: string;
  exclude?: string[];
  target?: HTMLSelectElement;
}): Promise<JantLocalePicker> {
  if (options?.target) document.body.appendChild(options.target);
  const el = document.createElement("jant-locale-picker") as JantLocalePicker;
  el.locales = locales;
  el.labels = labels;
  el.value = options?.value ?? "en";
  if (options?.exclude) el.exclude = options.exclude;
  if (options?.target) el.htmlFor = options.target.id;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function trigger(el: JantLocalePicker): HTMLButtonElement {
  const button = el.querySelector<HTMLButtonElement>("[data-language-trigger]");
  if (!button) throw new Error("trigger missing");
  return button;
}

function optionLabels(el: JantLocalePicker): string[] {
  return [...el.querySelectorAll('[role="option"]')].map(
    (node) => node.textContent?.trim() ?? "",
  );
}

async function press(el: JantLocalePicker, key: string) {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
  await el.updateComplete;
}

function makeSelect(id: string, value: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.id = id;
  for (const locale of locales) {
    const option = document.createElement("option");
    option.value = locale.tag;
    option.textContent = locale.native;
    select.appendChild(option);
  }
  select.value = value;
  return select;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("JantLocalePicker", () => {
  it("shows the selected language on the trigger", async () => {
    const el = await createPicker({ value: "zh-Hans" });
    expect(trigger(el).textContent).toContain("简体中文");
  });

  it("filters on native name, English name, or tag", async () => {
    const el = await createPicker();
    trigger(el).click();
    await el.updateComplete;
    expect(optionLabels(el)).toHaveLength(locales.length);

    const search = el.querySelector<HTMLInputElement>("[data-language-search]");
    if (!search) throw new Error("search missing");

    search.value = "finn";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    expect(optionLabels(el).join()).toContain("suomi");
    expect(optionLabels(el)).toHaveLength(1);

    search.value = "zh";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    expect(optionLabels(el).join()).toContain("简体中文");
  });

  it("leaves out excluded languages", async () => {
    const el = await createPicker({ exclude: ["ja", "fi"] });
    trigger(el).click();
    await el.updateComplete;
    expect(optionLabels(el)).toHaveLength(2);
  });

  it("says so when nothing matches", async () => {
    const el = await createPicker();
    trigger(el).click();
    await el.updateComplete;

    const search = el.querySelector<HTMLInputElement>("[data-language-search]");
    if (search) {
      search.value = "zzzz";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await el.updateComplete;
    expect(el.textContent).toContain(labels.empty);
  });

  it("moves through the list with the arrow keys and picks with Enter", async () => {
    const el = await createPicker();
    const chosen: string[] = [];
    el.addEventListener("locale-select", (event) => {
      chosen.push((event as CustomEvent<{ tag: string }>).detail.tag);
    });

    trigger(el).click();
    await el.updateComplete;

    await press(el, "ArrowDown");
    await press(el, "Enter");

    expect(chosen).toEqual(["zh-Hans"]);
    expect(el.value).toBe("zh-Hans");
  });

  it("wraps around at the end of the list", async () => {
    const el = await createPicker();
    trigger(el).click();
    await el.updateComplete;

    // Starts on the selected language (index 0), so one step back wraps.
    await press(el, "ArrowUp");
    const active = el.querySelector("[data-language-option][data-active]");
    expect(active?.textContent).toContain("suomi");
  });

  it("closes on Escape and on an outside click", async () => {
    const el = await createPicker();

    trigger(el).click();
    await el.updateComplete;
    expect(el.querySelector("[data-language-search]")).not.toBeNull();

    await press(el, "Escape");
    expect(el.querySelector("[data-language-search]")).toBeNull();

    trigger(el).click();
    await el.updateComplete;
    document.body.dispatchEvent(new Event("click", { bubbles: true }));
    await el.updateComplete;
    expect(el.querySelector("[data-language-search]")).toBeNull();
  });

  it("does not let Enter escape to a surrounding form", async () => {
    const el = await createPicker();
    let escaped = 0;
    document.body.addEventListener("keydown", () => {
      escaped++;
    });

    trigger(el).click();
    await el.updateComplete;
    await press(el, "Enter");

    expect(escaped).toBe(0);
  });

  it("writes the choice to the form control it drives", async () => {
    const select = makeSelect("content-language", "en");
    const el = await createPicker({ target: select });
    const events: string[] = [];
    select.addEventListener("input", () => events.push("input"));
    select.addEventListener("change", () => events.push("change"));

    trigger(el).click();
    await el.updateComplete;
    el.querySelectorAll<HTMLButtonElement>('[role="option"]')[2]?.click();
    await el.updateComplete;

    expect(select.value).toBe("ja");
    expect(events).toEqual(["input", "change"]);
  });

  it("takes the plain control out of the layout once it upgrades", async () => {
    const select = makeSelect("content-language", "ja");
    const el = await createPicker({ value: "", target: select });

    expect(select.hidden).toBe(true);
    // With no value of its own the picker adopts the control's, so it opens on
    // whatever the form would have posted.
    expect(trigger(el).textContent).toContain("日本語");
  });
});
