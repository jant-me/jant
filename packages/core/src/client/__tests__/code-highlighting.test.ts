// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { observeCodeHighlighting } from "../code-highlighting.js";

observeCodeHighlighting();

describe("post code highlighting", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("colors an inserted post's labeled code without changing its text", async () => {
    document.body.innerHTML =
      '<article data-post-body><pre><code class="language-js">const html = "&lt;b&gt;&amp;&lt;/b&gt;";</code></pre></article>';
    const code = document.querySelector("code")!;

    await vi.waitFor(() => {
      expect(code.querySelector(".hljs-keyword")?.textContent).toBe("const");
      expect(code.querySelector(".hljs-string")?.textContent).toBe(
        '"<b>&</b>"',
      );
    });
    expect(code.textContent).toBe('const html = "<b>&</b>";');
    expect(code.querySelector("b")).toBeNull();
  });

  it("preserves unmarked and unsupported blocks, inline code, and editor code", async () => {
    document.body.innerHTML = `
      <article data-post-body>
        <pre><code>const answer = 42;</code></pre>
        <pre><code class="language-not-supported">const answer = 42;</code></pre>
        <p><code class="language-js">const answer = 42;</code></p>
      </article>
      <div contenteditable><pre><code class="language-js">const answer = 42;</code></pre></div>
      <div data-code-theme-preview><pre><code class="language-js">const answer = 42;</code></pre></div>
    `;

    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-code-theme-preview] code.hljs"),
      ).not.toBeNull();
    });
    expect(document.querySelectorAll("code.hljs")).toHaveLength(1);
  });
});
