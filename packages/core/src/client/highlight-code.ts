import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

for (const [name, grammar] of Object.entries({
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  markdown,
  php,
  python,
  ruby,
  rust,
  sql,
  swift,
  typescript,
  xml,
  yaml,
})) {
  hljs.registerLanguage(name, grammar);
}

const MAX_HIGHLIGHT_LENGTH = 20_000;

/**
 * Highlight a plain-text code element with a supported language. The
 * highlighter escapes the source as it produces its token spans.
 *
 * @param code - Code element inside a rendered block
 * @returns Nothing
 * @example
 * highlightCode(document.querySelector("pre code.language-js")!);
 */
export function highlightCode(code: HTMLElement): void {
  if (code.classList.contains("hljs") || code.childElementCount) return;
  const language = [...code.classList]
    .find((name) => name.startsWith("language-"))
    ?.slice("language-".length)
    .toLowerCase();
  if (!language || !hljs.getLanguage(language)) return;

  const source = code.textContent;
  if (!source || source.length > MAX_HIGHLIGHT_LENGTH) return;

  code.innerHTML = hljs.highlight(source, { language }).value;
  code.classList.add("hljs");
}
