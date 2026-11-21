export const LABELED_CODE_BLOCK = "pre > code[class*='language-']";

const postCodeSelector = `:is([data-post-body], [data-code-theme-preview]) ${LABELED_CODE_BLOCK}`;

/**
 * Load the highlighter on demand and color the supplied code blocks.
 *
 * @param blocks - Language-marked code elements in the document
 * @returns A promise that settles once the blocks are ready to display
 * @example
 * await highlightCodeBlocks(card.querySelectorAll<HTMLElement>(LABELED_CODE_BLOCK));
 */
export async function highlightCodeBlocks(
  blocks: Iterable<HTMLElement>,
): Promise<void> {
  const codeBlocks = [...blocks];
  if (!codeBlocks.length) return;

  try {
    const { highlightCode } = await import("./highlight-code.js");
    for (const block of codeBlocks) {
      if (block.isConnected) highlightCode(block);
    }
  } catch {
    // A failed asset load leaves the original code readable.
  }
}

function collectBlocks(
  root: globalThis.Element,
  blocks: Set<HTMLElement>,
): void {
  if (root.matches(postCodeSelector) && root instanceof HTMLElement) {
    blocks.add(root);
  }
  for (const block of root.querySelectorAll<HTMLElement>(postCodeSelector)) {
    blocks.add(block);
  }
}

/**
 * Color posts and the settings preview, including fragments inserted later.
 *
 * @returns The observer for subsequent changes to the page
 * @example
 * observeCodeHighlighting();
 */
export function observeCodeHighlighting(): globalThis.MutationObserver {
  void highlightCodeBlocks(
    document.body.querySelectorAll<HTMLElement>(postCodeSelector),
  );

  const observer = new globalThis.MutationObserver((records) => {
    const blocks = new Set<HTMLElement>();
    for (const { target, addedNodes } of records) {
      // A morph can replace just the text within an existing code element.
      if (
        target instanceof HTMLElement &&
        target.matches(postCodeSelector) &&
        !target.classList.contains("hljs")
      ) {
        blocks.add(target);
      }
      for (const node of addedNodes) {
        if (node instanceof globalThis.Element) collectBlocks(node, blocks);
      }
    }
    void highlightCodeBlocks(blocks);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}
