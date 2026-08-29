/**
 * Link Toolbar Extension
 *
 * Unified floating popover with two fields (text + URL) and a confirm button.
 * - Shown automatically (unfocused) when the cursor enters a link.
 * - Shown focused when the bubble-menu link action is triggered.
 * - Clearing the URL and confirming removes the link (keeps the text).
 *
 * Replaces the browser prompt() dialog for link creation.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  getFixedFloatingContainerRect,
  getFloatingArrowOffset,
  getFloatingPosition,
  getRangeAnchorRect,
  getVisibleClipRect,
} from "./floating-position.js";

const linkToolbarKey = new PluginKey("linkToolbar");

type Mode = "hidden" | "input";
let currentMode: Mode = "hidden";
let currentFocused = false;

/**
 * Returns true when the link input popup has keyboard focus. Used by bubble
 * menu to hide itself only when the user is actively editing a link — a
 * passive (unfocused) popup should not suppress the bubble menu.
 */
export function isLinkToolbarInputActive(): boolean {
  return currentMode === "input" && currentFocused;
}

const ICON_ENTER = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>`;

interface LinkRange {
  from: number;
  to: number;
  href: string;
}

/** Find the extent of a link mark around the cursor position. */
function getLinkRange(state: EditorState): LinkRange | null {
  const { selection } = state;
  if (!selection.empty) return null;

  const $pos = selection.$from;
  const linkType = state.schema.marks.link;
  if (!linkType) return null;

  const marks = $pos.marks();
  const linkMark = marks.find((m) => m.type === linkType);
  if (!linkMark) return null;

  // Walk the parent node's children to find the text range covered by this link
  const parent = $pos.parent;
  const parentOffset = $pos.start();
  let from = 0;
  let to = 0;
  let found = false;
  let offset = 0;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childFrom = parentOffset + offset;
    const childTo = childFrom + child.nodeSize;

    if (
      child.marks.some(
        (m) => m.type === linkType && m.attrs.href === linkMark.attrs.href,
      )
    ) {
      if (!found) {
        from = childFrom;
        found = true;
      }
      to = childTo;
    } else if (found) {
      break;
    }

    offset += child.nodeSize;
  }

  if (!found) return null;
  return { from, to, href: linkMark.attrs.href as string };
}

export const LinkToolbar = Extension.create({
  name: "linkToolbar",

  addProseMirrorPlugins() {
    const editor = this.editor;

    // DOM elements
    let inputEl: HTMLElement | null = null;
    let inputField: HTMLInputElement | null = null;
    let textField: HTMLInputElement | null = null;

    // State
    let savedFrom = 0;
    let savedTo = 0;
    let suppressNextUpdate = false;
    // Suppresses auto-showing the popup when the cursor sits inside a link —
    // set after the user explicitly dismisses (Escape / outside click) so the
    // popup doesn't reappear until the cursor moves off and back onto a link.
    let suppressAutoShow = false;
    let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

    function createElements() {
      inputEl = document.createElement("div");
      inputEl.className = "tiptap-link-input";
      inputEl.dataset.editorFloatingUi = "true";
      inputEl.style.display = "none";

      const fieldsEl = document.createElement("div");
      fieldsEl.className = "tiptap-link-input-fields";

      textField = document.createElement("input");
      textField.type = "text";
      textField.className = "tiptap-link-input-text";
      textField.placeholder = "Link text";

      inputField = document.createElement("input");
      inputField.type = "url";
      inputField.className = "tiptap-link-input-field";
      inputField.placeholder = "https:// (empty to unlink)";

      fieldsEl.appendChild(textField);
      fieldsEl.appendChild(inputField);

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "tiptap-link-input-confirm";
      confirmBtn.innerHTML = ICON_ENTER;
      confirmBtn.title = "Apply link";

      inputEl.appendChild(fieldsEl);
      inputEl.appendChild(confirmBtn);

      // Input key handling — shared for both fields
      const fieldKeyHandler = (e: globalThis.KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          confirmLink();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          suppressAutoShow = true;
          hideAll();
          editor.commands.focus();
        }
      };
      textField.addEventListener("keydown", fieldKeyHandler);
      inputField.addEventListener("keydown", fieldKeyHandler);

      const focusHandler = () => {
        currentFocused = true;
      };
      const blurHandler = () => {
        // Delay so another field within the popup can regain focus first.
        requestAnimationFrame(() => {
          const active = document.activeElement;
          if (!inputEl || !inputEl.contains(active)) {
            currentFocused = false;
          }
        });
      };
      textField.addEventListener("focus", focusHandler);
      inputField.addEventListener("focus", focusHandler);
      textField.addEventListener("blur", blurHandler);
      inputField.addEventListener("blur", blurHandler);

      // Confirm button
      confirmBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        confirmLink();
      });

      // Prevent popup clicks from bubbling to editor / outside-click handler
      inputEl.addEventListener("mousedown", (e) => {
        e.stopPropagation();
      });
    }

    function positionPopup(
      el: HTMLElement,
      view: EditorView,
      from: number,
      to: number,
    ) {
      el.style.display = "flex";

      const dialog = view.dom.closest("dialog");
      const containerRect = getFixedFloatingContainerRect(dialog);
      const anchorRect = getRangeAnchorRect(
        view,
        from,
        to,
        getVisibleClipRect(view.dom, containerRect),
      );
      const rect = el.getBoundingClientRect();
      const layout = getFloatingPosition({
        anchorRect,
        containerRect,
        floatingWidth: rect.width,
        floatingHeight: rect.height,
        preferredPlacement: "top",
        fallbackPlacement: "bottom",
        align: "center",
      });

      el.style.left = `${layout.left}px`;
      el.style.top = `${layout.top}px`;
      el.dataset.placement = layout.placement;
      el.style.setProperty(
        "--floating-arrow-x",
        `${getFloatingArrowOffset({
          anchorRect,
          containerRect,
          floatingLeft: layout.left,
          floatingWidth: rect.width,
        })}px`,
      );
    }

    interface ShowInputOptions {
      href: string;
      from?: number;
      to?: number;
      text?: string;
      /** When true, focuses the first relevant field. Defaults to false. */
      focus?: boolean;
    }

    function showInput(view: EditorView, opts: ShowInputOptions) {
      if (!inputEl || !inputField || !textField) return;

      if (opts.from !== undefined && opts.to !== undefined) {
        savedFrom = opts.from;
        savedTo = opts.to;
      } else {
        savedFrom = view.state.selection.from;
        savedTo = view.state.selection.to;
      }

      currentMode = "input";
      inputField.value = opts.href;
      textField.value =
        opts.text ?? view.state.doc.textBetween(savedFrom, savedTo, "");
      positionPopup(inputEl, view, savedFrom, savedTo);

      if (opts.focus) {
        const focusUrl = textField.value.length > 0;
        const field = focusUrl ? inputField : textField;
        requestAnimationFrame(() => {
          field.focus();
          field.select();
        });
      }

      removeOutsideClickHandler();
      outsideClickHandler = (e: MouseEvent) => {
        if (inputEl && !inputEl.contains(e.target as Node)) {
          suppressAutoShow = true;
          hideAll();
        }
      };
      setTimeout(() => {
        if (outsideClickHandler) {
          document.addEventListener("mousedown", outsideClickHandler, true);
        }
      }, 0);
    }

    function hideAll() {
      if (inputEl) inputEl.style.display = "none";
      currentMode = "hidden";
      currentFocused = false;
      removeOutsideClickHandler();
    }

    function removeOutsideClickHandler() {
      if (outsideClickHandler) {
        document.removeEventListener("mousedown", outsideClickHandler, true);
        outsideClickHandler = null;
      }
    }

    function confirmLink() {
      if (!inputField || !textField) return;
      const url = inputField.value.trim();
      const currentText = editor.state.doc.textBetween(savedFrom, savedTo, "");
      const rawText = textField.value;
      // Fall back to URL when the text field is empty so the link is never
      // empty; if both are empty we'll unlink below.
      const newText = rawText.length > 0 ? rawText : url;
      hideAll();

      if (!url) {
        // Empty URL — unlink but keep the original text intact.
        editor
          .chain()
          .focus()
          .setTextSelection({ from: savedFrom, to: savedTo })
          .unsetLink()
          .setTextSelection(savedTo)
          .run();
        suppressNextUpdate = true;
        return;
      }

      const textChanged = newText !== currentText;
      const endPos = savedFrom + newText.length;

      if (textChanged) {
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.insertText(newText, savedFrom, savedTo);
            return true;
          })
          .setTextSelection({ from: savedFrom, to: endPos })
          .setLink({ href: url })
          .setTextSelection(endPos)
          .run();
      } else {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: savedFrom, to: savedTo })
          .setLink({ href: url })
          .setTextSelection(savedTo)
          .run();
      }

      suppressNextUpdate = true;
    }

    /**
     * Open the passive link popover when a link is clicked or tapped.
     *
     * The popover is otherwise shown only as a side effect of a collapsed
     * caret landing inside a link (see the plugin `update` below). A mouse
     * click reliably drops that caret, but a touch tap often does not — it may
     * leave the selection unchanged or select a word — so on mobile the popover
     * never appeared. Here we read the tapped position directly and force a
     * collapsed caret inside the link, which works for both pointer types.
     */
    function handleLinkClick(view: EditorView, event: MouseEvent) {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor || !view.dom.contains(anchor)) return;

      const linkType = view.state.schema.marks.link;
      if (!linkType) return;

      // Don't disturb an active range selection (e.g. drag-selecting link
      // text) — that case is owned by the bubble menu.
      if (!view.state.selection.empty) return;

      // When the click already dropped a caret inside a link (the desktop
      // path), keep it where the user clicked. On touch the tap often doesn't
      // move the caret into the link, so derive a position from the anchor
      // element itself — targeting this exact link regardless of where the
      // user tapped.
      const cur = view.state.selection.from;
      const hasLink = (p: number) =>
        view.state.doc
          .resolve(p)
          .marks()
          .some((m) => m.type === linkType);

      let pos = cur;
      if (!hasLink(cur)) {
        try {
          pos = view.posAtDOM(anchor, 0) + 1;
        } catch {
          return;
        }
        if (pos < 0 || pos > view.state.doc.content.size) return;
        if (!hasLink(pos)) return;
      }

      // Re-show even if the user previously dismissed it, then (re)place a
      // collapsed caret in the link so the passive popover flow picks it up.
      suppressAutoShow = false;
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
      );
    }

    return [
      new Plugin({
        key: linkToolbarKey,
        props: {
          handleDOMEvents: {
            click: (view, event) => {
              handleLinkClick(view, event as MouseEvent);
              return false;
            },
          },
        },
        view(editorView) {
          createElements();
          const dialog = editorView.dom.closest("dialog");
          if (inputEl) (dialog ?? document.body).appendChild(inputEl);

          // Bubble menu link button — opens focused for immediate typing.
          // Suppress the next plugin update so the blur/selection change from
          // focusing the input field doesn't immediately hide the popup
          // (getLinkRange returns null when the selection isn't yet a link).
          const openHandler = () => {
            suppressAutoShow = false;
            suppressNextUpdate = true;
            showInput(editorView, { href: "", focus: true });
          };
          editorView.dom.addEventListener(
            "tiptap:open-link-input",
            openHandler,
          );

          // Escape from the editor (not just the fields) dismisses the popup.
          const keyHandler = (e: globalThis.KeyboardEvent) => {
            if (e.key === "Escape" && currentMode === "input") {
              e.preventDefault();
              e.stopPropagation();
              suppressAutoShow = true;
              hideAll();
            }
          };
          editorView.dom.addEventListener("keydown", keyHandler);

          return {
            update(view) {
              if (suppressNextUpdate) {
                suppressNextUpdate = false;
                return;
              }

              const range = getLinkRange(view.state);

              // If the popup is already open with focus, don't steal focus
              // from the user; just reposition to follow the current range.
              if (currentMode === "input" && currentFocused) {
                if (inputEl) {
                  positionPopup(inputEl, view, savedFrom, savedTo);
                }
                return;
              }

              if (range) {
                if (suppressAutoShow) return;
                // Show passive (unfocused) popup over the link under cursor.
                showInput(view, {
                  href: range.href,
                  from: range.from,
                  to: range.to,
                  focus: false,
                });
              } else {
                // Cursor left the link — reset suppress flag and hide.
                suppressAutoShow = false;
                if (currentMode === "input") {
                  hideAll();
                }
              }
            },
            destroy() {
              editorView.dom.removeEventListener(
                "tiptap:open-link-input",
                openHandler,
              );
              editorView.dom.removeEventListener("keydown", keyHandler);
              removeOutsideClickHandler();
              inputEl?.remove();
              inputEl = null;
              currentMode = "hidden";
              currentFocused = false;
            },
          };
        },
      }),
    ];
  },
});
