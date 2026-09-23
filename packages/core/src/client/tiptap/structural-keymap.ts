/**
 * Compose Structural Keymap
 *
 * Block boundaries follow the editing model shared by Notion and Google Docs,
 * mapped onto what Markdown can represent. Tiptap's official keymaps already
 * implement most of it; this extension owns only the cases where they differ,
 * and delegates everything else.
 *
 * Backspace at the start of a line removes one layer at a time:
 *   - A list item loses its marker first and becomes a paragraph where it
 *     stands. Tiptap does this for top-level items. A nested item stays inside
 *     its parent item instead of being outdented, which is Tiptap's default;
 *     Shift-Tab and Enter on an empty item remain the outdent keys.
 *   - A paragraph then merges into the line visually above it, however deep
 *     that line is nested.
 *
 * Delete at the end of a line always pulls the next line's text up, whatever
 * its list depth. The two keys are intentionally not symmetric: Backspace
 * deletes the marker just before the caret, Delete deletes the line break.
 *
 * Markdown differs from Notion in one place: a paragraph cannot own a nested
 * list. When an item loses its marker, or its text merges into a shallower
 * line, its children move up one level instead of staying indented.
 */

import { Extension, type Editor } from "@tiptap/core";
import {
  Fragment,
  NodeRange,
  type Node as ProseMirrorNode,
  type ResolvedPos,
} from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { liftTarget } from "@tiptap/pm/transform";

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

function isListNode(node: ProseMirrorNode | null | undefined): boolean {
  const name = node?.type.name;
  return name === "bulletList" || name === "orderedList";
}

function findDirectListItemDepth($cursor: ResolvedPos): number | null {
  const listItemDepth = $cursor.depth - 1;
  if (
    listItemDepth <= 0 ||
    $cursor.node(listItemDepth).type.name !== "listItem"
  ) {
    return null;
  }

  return isListNode($cursor.node(listItemDepth - 1)) ? listItemDepth : null;
}

/**
 * Removes a nested item's marker while keeping it inside its parent item: the
 * item's content becomes blocks of the parent item, splitting the nested list
 * around it.
 * Top-level items are left to the official ListKeymap, which does the same
 * against the document or blockquote.
 */
function unwrapNestedListItem(editor: Editor, listItemDepth: number): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  if ($from.node(listItemDepth - 2).type.name !== "listItem") return false;

  const range = new NodeRange(
    state.doc.resolve($from.start(listItemDepth)),
    state.doc.resolve($from.end(listItemDepth)),
    listItemDepth,
  );
  const target = liftTarget(range);
  if (target === null) return false;

  editor.view.dispatch(state.tr.lift(range, target).scrollIntoView());
  return true;
}

function handleListBackspace(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  const listItemDepth = findDirectListItemDepth($from);
  if (listItemDepth === null) return false;

  const childIndex = $from.index(listItemDepth);
  if (childIndex === 0) return unwrapNestedListItem(editor, listItemDepth);

  // A markerless paragraph after an adjacent textblock is joined by the
  // official keymap. After a nested list the official fallback would wrap the
  // paragraph into that list instead, so merge into the line visually above.
  const previousChild = $from.node(listItemDepth).child(childIndex - 1);
  if (previousChild.isTextblock) return false;

  return editor.commands.joinTextblockBackward();
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
    handleListBackspace(editor) ||
    joinBlockquoteParagraphBoundary(editor, "backward")
  );
}

/** Mirrors ProseMirror's `findCutAfter`, which prosemirror-commands keeps private. */
function findCutAfter($pos: ResolvedPos): ResolvedPos | null {
  if ($pos.parent.type.spec.isolating) return null;

  for (let depth = $pos.depth - 1; depth >= 0; depth -= 1) {
    const parent = $pos.node(depth);
    if ($pos.index(depth) + 1 < parent.childCount) {
      return $pos.doc.resolve($pos.after(depth + 1));
    }
    if (parent.type.spec.isolating) break;
  }

  return null;
}

/**
 * Pulls the first item of a directly following deeper list up into the
 * caret's line. The item's text joins the line; its children cannot stay
 * nested under a line that is no longer there, so they move up one level and
 * sit between the joined line and the rest of the list.
 */
function pullUpFirstItemOfNestedList(
  editor: Editor,
  $cut: ResolvedPos,
): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const list = $cut.nodeAfter;
  const item = list?.firstChild;
  const itemText = item?.firstChild;
  if (!list || !item || item.childCount < 2 || !itemText?.isTextblock) {
    return false;
  }
  if ($from.parent.type.spec.code) return false;

  const children = item.content.cut(itemText.nodeSize);
  const remainingItems = list.content.cut(item.nodeSize);
  const replacement =
    remainingItems.size > 0
      ? children.addToEnd(list.copy(remainingItems))
      : children;
  const index = $cut.index();
  if (!$cut.parent.canReplace(index, index + 1, replacement)) return false;

  const tr = state.tr
    .replaceWith($cut.pos, $cut.pos + list.nodeSize, replacement)
    .insert($from.pos, Fragment.from(itemText.content));
  tr.setSelection(TextSelection.create(tr.doc, $from.pos));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function handleListDelete(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;

  const { $from } = selection;
  if (
    !$from.parent.isTextblock ||
    $from.parentOffset !== $from.parent.content.size
  ) {
    return false;
  }

  const $cut = findCutAfter($from);
  if (!$cut) return false;

  // Only boundaries that cross list structure are Jant's. Between plain
  // blocks the official Delete already joins the next textblock.
  const { nodeBefore, nodeAfter } = $cut;
  const crossesList =
    isListNode(nodeBefore) ||
    isListNode(nodeAfter) ||
    nodeBefore?.type.name === "listItem";
  if (!crossesList) return false;

  if ($cut.pos === $from.after() && isListNode(nodeAfter)) {
    if (pullUpFirstItemOfNestedList(editor, $cut)) return true;
  }

  return editor.commands.joinTextblockForward();
}

function handleDelete(editor: Editor): boolean {
  return (
    joinBlockquoteParagraphBoundary(editor, "forward") ||
    handleListDelete(editor)
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
      Delete: ({ editor }) => handleDelete(editor),
      "Mod-Delete": ({ editor }) => handleDelete(editor),
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
