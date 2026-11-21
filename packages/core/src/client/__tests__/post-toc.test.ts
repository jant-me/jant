// @vitest-environment happy-dom

import { expect, it } from "vitest";
import { initPostToc } from "../post-toc.js";

it("dismisses the narrow-screen directory on Escape, outside click, and selection", () => {
  document.body.innerHTML = `
    <nav data-post-toc>
      <button data-post-toc-trigger aria-expanded="false">Contents</button>
      <a href="#section-intro" data-post-toc-link="section-intro">Intro</a>
    </nav>
    <h2 id="section-intro" tabindex="-1">Intro</h2>
  `;
  initPostToc(document);
  const button = document.querySelector<HTMLButtonElement>("button")!;
  const link = document.querySelector<HTMLAnchorElement>("a")!;
  const heading = document.querySelector<HTMLElement>("h2")!;

  button.click();
  expect(button.getAttribute("aria-expanded")).toBe("true");
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
  link.click();
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(heading);
});
