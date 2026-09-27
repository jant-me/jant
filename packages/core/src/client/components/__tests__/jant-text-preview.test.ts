// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "../jant-text-preview.js";
import type { JantTextPreview } from "../jant-text-preview.js";

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

async function flush(el?: JantTextPreview) {
  await Promise.resolve();
  await Promise.resolve();
  if (el) {
    await el.updateComplete;
  }
}

async function createElement(): Promise<JantTextPreview> {
  const el = document.createElement("jant-text-preview") as JantTextPreview;
  document.body.appendChild(el);
  await flush(el);
  return el;
}

function createTrigger() {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.dataset.textPreviewId = "med_123";
  document.body.appendChild(trigger);
  return trigger;
}

/** What `/_/text/{id}` answers: rendered HTML and the file's source. */
function previewResponse(html: string, source: string): Response {
  return new Response(JSON.stringify({ html, source }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("JantTextPreview", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    installDialogShim();
  });

  it("focuses the preview content instead of the close button when opened", async () => {
    const el = await createElement();
    let resolveFetch!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const trigger = createTrigger();

    trigger.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }),
    );
    await flush(el);

    const content = el.querySelector<HTMLElement>(".text-preview-content");
    const closeButton = el.querySelector<HTMLButtonElement>(
      ".text-preview-toolbar .text-preview-btn",
    );

    expect(content).not.toBeNull();
    expect(document.activeElement).toBe(content);
    expect(document.activeElement).not.toBe(closeButton);

    resolveFetch(previewResponse("<p>Hello</p>", "Hello"));
    await flush(el);
  });

  it("returns focus to the trigger after closing", async () => {
    const el = await createElement();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      previewResponse("<p>Hello</p>", "Hello"),
    );
    const trigger = createTrigger();
    trigger.focus();

    trigger.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }),
    );
    await flush(el);

    el.querySelector<HTMLButtonElement>(
      ".text-preview-toolbar .text-preview-btn",
    )?.click();
    await flush(el);

    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  it("adopts SSR dialog content and removes it after hydration", async () => {
    // Simulate SSR: dialog with content + metadata script
    const ssrDialog = document.createElement("dialog");
    ssrDialog.className = "text-preview-dialog text-preview-dialog--ssr";
    ssrDialog.open = true;
    ssrDialog.innerHTML = `
      <div class="text-preview-content">
        <div class="text-preview-toolbar"></div>
        <div class="text-preview-body prose"><p>SSR content</p></div>
      </div>
    `;
    document.body.appendChild(ssrDialog);

    const script = document.createElement("script");
    script.type = "application/json";
    script.id = "text-preview-autoopen";
    script.textContent = JSON.stringify({
      shareHref: "/post/text/med_123",
      postHref: "/post",
      postTitle: "My Post",
    });
    document.body.appendChild(script);

    const el = await createElement();
    await flush(el);
    await flush(el);

    // Lit dialog should be open with the SSR content
    const litDialog = el.querySelector<HTMLDialogElement>(
      ".text-preview-dialog",
    );
    expect(litDialog).not.toBeNull();
    expect(litDialog?.open).toBe(true);
    expect(el.querySelector(".text-preview-body")?.innerHTML).toContain(
      "<p>SSR content</p>",
    );

    // SSR dialog should be removed
    expect(document.querySelector(".text-preview-dialog--ssr")).toBeNull();

    // Metadata script should be removed
    expect(document.getElementById("text-preview-autoopen")).toBeNull();
  });

  it("renders the HTML /_/text returns, and fetches it under the site's path", async () => {
    // The server renders or escapes the file, so the dialog inserts `html`
    // as DOM. It used to insert any non-JSON response as HTML, which let a
    // plain-text file's markup through.
    const el = await createElement();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        previewResponse("<h1>Heading</h1><p>Body</p>", "# Heading\n\nBody"),
      );
    const trigger = createTrigger();

    trigger.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }),
    );
    await flush(el);
    await flush(el);

    expect(String(fetchSpy.mock.calls[0]?.[0])).toMatch(/\/_\/text\/med_/);
    const body = el.querySelector(".text-preview-body");
    expect(body?.querySelector("h1")?.textContent).toBe("Heading");
    expect(body?.querySelector("p")?.textContent).toBe("Body");
  });
});
