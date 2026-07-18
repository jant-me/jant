/**
 * Compose Structural Keymap
 *
 * Keeps Jant's small set of product-specific block-boundary decisions in one
 * place while delegating every unowned case to Tiptap's official keymaps.
 */

import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";

type Direction = "backward" | "forward";

interface DirectParagraph {
  kind: "plain" | "quote";
  topIndex: number;
  quoteChildIndex?: number;
}

function locateDirectParagraph($cursor: ResolvedPos): DirectParagraph | null {
  const { schema } = $cursor.doc.type;
  if ($cursor.parent.type !== schema.nodes.paragraph) return null;

  if ($cursor.depth === 1) {
    return { kind: "plain", topIndex: $cursor.index(0) };
  }

  if ($cursor.depth === 2 && $cursor.node(1).type === schema.nodes.blockquote) {
    return {
      kind: "quote",
      topIndex: $cursor.index(0),
      quoteChildIndex: $cursor.index(1),
    };
  }

  return null;
}

function paragraphKindAtQuoteEdge(
  node: ProseMirrorNode,
  direction: Direction,
): DirectParagraph["kind"] | null {
  if (node.type.name !== "blockquote") return null;

  const edge = direction === "backward" ? node.lastChild : node.firstChild;
  return edge?.type.name === "paragraph" ? "quote" : null;
}

function findNeighborParagraphKind(
  $cursor: ResolvedPos,
  current: DirectParagraph,
  direction: Direction,
): DirectParagraph["kind"] | null {
  const offset = direction === "backward" ? -1 : 1;

  if (current.kind === "quote") {
    const quote = $cursor.doc.child(current.topIndex);
    const childIndex = current.quoteChildIndex;
    if (childIndex === undefined) return null;

    const neighborIndex = childIndex + offset;
    if (neighborIndex >= 0 && neighborIndex < quote.childCount) {
      return quote.child(neighborIndex).type.name === "paragraph"
        ? "quote"
        : null;
    }
  }

  const topIndex = current.topIndex + offset;
  if (topIndex < 0 || topIndex >= $cursor.doc.childCount) return null;

  const topNode = $cursor.doc.child(topIndex);
  if (topNode.type.name === "paragraph") return "plain";

  return paragraphKindAtQuoteEdge(topNode, direction);
}

function joinBlockquoteParagraphBoundary(
  editor: Editor,
  direction: Direction,
): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;

  const { $from } = selection;
  const atBoundary =
    direction === "backward"
      ? $from.parentOffset === 0
      : $from.parentOffset === $from.parent.content.size;
  if (!atBoundary) return false;

  const current = locateDirectParagraph($from);
  if (!current) return false;

  const neighborKind = findNeighborParagraphKind($from, current, direction);
  if (!neighborKind || (current.kind !== "quote" && neighborKind !== "quote")) {
    return false;
  }

  return direction === "backward"
    ? editor.commands.joinTextblockBackward()
    : editor.commands.joinTextblockForward();
}

function findDirectListItemDepth($cursor: ResolvedPos): number | null {
  const listItemDepth = $cursor.depth - 1;
  if (
    listItemDepth <= 0 ||
    $cursor.node(listItemDepth).type.name !== "listItem"
  ) {
    return null;
  }

  const listDepth = listItemDepth - 1;
  const listName = $cursor.node(listDepth).type.name;
  return listName === "bulletList" || listName === "orderedList"
    ? listItemDepth
    : null;
}

function joinListItemBackward(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;

  const { $from } = selection;
  if ($from.parentOffset !== 0 || !$from.parent.isTextblock) return false;

  const listItemDepth = findDirectListItemDepth($from);
  if (listItemDepth === null) return false;

  const listItem = $from.node(listItemDepth);
  const childIndex = $from.index(listItemDepth);

  if (childIndex > 0) {
    const previousChild = listItem.child(childIndex - 1);
    if (previousChild.isTextblock) {
      return editor.commands.joinTextblockBackward();
    }

    // A paragraph following a nested structural block has no unambiguous
    // one-key merge target. Consume Backspace instead of letting ListKeymap
    // lift and split the entire list item.
    return true;
  }

  const listDepth = listItemDepth - 1;
  const itemIndex = $from.index(listDepth);
  if (itemIndex === 0) {
    // Let the official ListKeymap lift a first/nested-first item.
    return false;
  }

  if (editor.commands.joinItemBackward()) return true;

  // `joinItemBackward` cannot join when the previous item already owns a
  // nested list. The official textblock join safely removes the current marker
  // while preserving both subtrees in their existing document order.
  if (editor.commands.joinBackward()) return true;

  // A same-level previous item exists, so never fall through to the official
  // lift behavior, which would split the surrounding list into top-level blocks.
  return true;
}

function handleBackspace(editor: Editor): boolean {
  const { selection } = editor.state;
  if (
    !selection.empty ||
    !selection.$from.parent.isTextblock ||
    selection.$from.parentOffset !== 0
  ) {
    return false;
  }

  // Let the official input-rule undo run before any Jant boundary behavior, so
  // Backspace immediately after `- ` or `> ` reverses that structural change.
  if (editor.commands.undoInputRule()) return true;

  return (
    joinListItemBackward(editor) ||
    joinBlockquoteParagraphBoundary(editor, "backward")
  );
}

export const StructuralKeymap = Extension.create({
  name: "structuralKeymap",
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => handleBackspace(editor),
      "Mod-Backspace": ({ editor }) => handleBackspace(editor),
      "Shift-Backspace": ({ editor }) => handleBackspace(editor),
      Delete: ({ editor }) =>
        joinBlockquoteParagraphBoundary(editor, "forward"),
      "Mod-Delete": ({ editor }) =>
        joinBlockquoteParagraphBoundary(editor, "forward"),
      Tab: ({ editor }) => {
        if (!editor.isActive("listItem")) return false;

        editor.commands.sinkListItem("listItem");
        return true;
      },
      "Shift-Tab": ({ editor }) => {
        if (!editor.isActive("listItem")) return false;

        editor.commands.liftListItem("listItem");
        return true;
      },
    };
  },
});
