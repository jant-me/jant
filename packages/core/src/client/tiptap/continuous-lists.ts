/**
 * Continuous Lists
 *
 * Rich-text sources can paste one visual list as several adjacent list nodes.
 * Adjacent wrappers of the same type have no visible or semantic separator, so
 * normalize them into one list. A paragraph, a different list type, or any
 * other block remains an intentional boundary.
 */

import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { canJoin } from "@tiptap/pm/transform";

function isStandardList(node: ProseMirrorNode): boolean {
  return node.type.name === "bulletList" || node.type.name === "orderedList";
}

function findJoinableListBoundary(
  node: ProseMirrorNode,
  nodePosition = -1,
  document = node,
): number | null {
  const contentStart = nodePosition + 1;
  let childOffset = 0;
  let previousChild: ProseMirrorNode | null = null;

  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    const childPosition = contentStart + childOffset;

    if (
      previousChild &&
      isStandardList(previousChild) &&
      previousChild.type === child.type &&
      canJoin(document, childPosition)
    ) {
      return childPosition;
    }

    const nestedBoundary = findJoinableListBoundary(
      child,
      childPosition,
      document,
    );
    if (nestedBoundary !== null) return nestedBoundary;

    childOffset += child.nodeSize;
    previousChild = child;
  }

  return null;
}

/**
 * Builds a transaction that joins every adjacent same-type list fragment.
 *
 * @param state - Current editor state
 * @returns A joining transaction, or null when the document is normalized
 * @example
 * const tr = buildContinuousListsTransaction(editor.state);
 * if (tr) editor.view.dispatch(tr);
 */
export function buildContinuousListsTransaction(
  state: EditorState,
): Transaction | null {
  const tr = state.tr;
  let changed = false;
  let boundary = findJoinableListBoundary(tr.doc);

  while (boundary !== null) {
    tr.join(boundary);
    changed = true;
    boundary = findJoinableListBoundary(tr.doc);
  }

  return changed ? tr : null;
}

export const ContinuousLists = Extension.create({
  name: "continuousLists",

  onCreate() {
    const tr = buildContinuousListsTransaction(this.editor.state);
    if (tr) this.editor.view.dispatch(tr.setMeta("addToHistory", false));
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) {
            return null;
          }

          return buildContinuousListsTransaction(newState);
        },
      }),
    ];
  },
});
