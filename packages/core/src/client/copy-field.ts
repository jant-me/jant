/**
 * Copy field behavior.
 *
 * Enhances the read-only address fields rendered by `ui/shared/CopyField.tsx`
 * and by the feed URL rows in General settings. Delegated from the document, so
 * fields that appear later — the settings page renders its rows from Lit after
 * load — are covered without re-running anything.
 *
 * Two behaviors carry the weight here and must both stay:
 *
 * - The button writes the address to the clipboard and reports either way.
 * - Clicking or focusing the input selects the whole address. The Clipboard API
 *   is absent on insecure origins and can be denied by permission, so manual
 *   selection is what keeps the address obtainable when the button cannot work.
 *
 * The server renders the button `hidden` — without this script it would be an
 * affordance that does nothing — and it is revealed here. The input alone is
 * the no-JavaScript state, and it is a usable one.
 */

import {
  COPY_FIELD_BUTTON_ATTR,
  COPY_FIELD_FAILED_ATTR,
  COPY_FIELD_VALUE_ATTR,
} from "../lib/copy-field.js";
import { showToast } from "./toast.js";

const BUTTON_SELECTOR = `[${COPY_FIELD_BUTTON_ATTR}]`;
const VALUE_SELECTOR = `[${COPY_FIELD_VALUE_ATTR}]`;

/**
 * Find the address a copy button belongs to.
 *
 * @param button - The copy button that was activated
 * @returns The input holding the address, or null when the field is malformed
 */
function findValueInput(button: HTMLElement): HTMLInputElement | null {
  return (
    button.parentElement?.querySelector<HTMLInputElement>(VALUE_SELECTOR) ??
    button
      .closest("[data-copy-field-root]")
      ?.querySelector<HTMLInputElement>(VALUE_SELECTOR) ??
    null
  );
}

async function copy(button: HTMLElement): Promise<void> {
  const input = findValueInput(button);
  if (!input) return;

  const failedMessage = button.getAttribute(COPY_FIELD_FAILED_ATTR) ?? "";

  try {
    if (!globalThis.navigator.clipboard?.writeText) {
      throw new Error("Clipboard unavailable");
    }

    await globalThis.navigator.clipboard.writeText(input.value);
    showToast(button.getAttribute(COPY_FIELD_BUTTON_ATTR) || "");
  } catch {
    showToast(failedMessage, "error");
  }
}

/** Reveal buttons the server rendered hidden. */
function revealButtons(root: globalThis.ParentNode = document): void {
  for (const button of Array.from(
    root.querySelectorAll<HTMLElement>(`${BUTTON_SELECTOR}[hidden]`),
  )) {
    button.hidden = false;
  }
}

document.addEventListener("click", (event: globalThis.MouseEvent) => {
  const target = event.target;
  if (!(target instanceof globalThis.Element)) return;

  const button = target.closest<HTMLElement>(BUTTON_SELECTOR);
  if (button) {
    event.preventDefault();
    void copy(button);
    return;
  }

  const input = target.closest<HTMLInputElement>(VALUE_SELECTOR);
  if (input) input.select();
});

// Focus does not bubble; its capturing counterpart does.
document.addEventListener(
  "focus",
  (event: globalThis.FocusEvent) => {
    const target = event.target;
    if (!(target instanceof globalThis.Element)) return;

    const input = target.closest<HTMLInputElement>(VALUE_SELECTOR);
    if (input) input.select();
  },
  true,
);

// Module scripts are deferred, so by the time this runs the server's fields are
// already parsed — but the listener is registered unconditionally rather than
// branching on readyState, so a field that arrives late is revealed too.
revealButtons();
document.addEventListener("DOMContentLoaded", () => revealButtons(), {
  once: true,
});
