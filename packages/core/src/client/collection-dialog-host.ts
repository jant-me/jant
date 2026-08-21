/**
 * Collection dialog host.
 *
 * One dialog element for the whole page, mounted lazily and reused. Four
 * places open it — the collections page toolbar, a directory row's menu, a
 * collection page's own menu, and the navigation manager — and they all go
 * through {@link openCollectionDialog}, because creating and editing are one
 * surface.
 */

import "./components/jant-collection-dialog.js";
import type { JantCollectionDialog } from "./components/jant-collection-dialog.js";
import type {
  CollectionDialogLabels,
  CollectionDialogResult,
} from "./components/collection-dialog-types.js";

const LABELS_ATTRIBUTE = "data-collection-dialog-labels";

let labels: CollectionDialogLabels | null = null;
let element: JantCollectionDialog | null = null;

/**
 * The dialog's strings, rendered into the page by whichever surface can open
 * it. Read once and cached: they are the same on every surface of a page.
 */
function readLabels(): CollectionDialogLabels | null {
  if (labels) return labels;
  const holder = document.querySelector<HTMLElement>(`[${LABELS_ATTRIBUTE}]`);
  const raw = holder?.getAttribute(LABELS_ATTRIBUTE);
  if (!raw) return null;
  try {
    labels = JSON.parse(raw) as CollectionDialogLabels;
    return labels;
  } catch {
    return null;
  }
}

function ensureElement(
  dialogLabels: CollectionDialogLabels,
): JantCollectionDialog {
  if (element?.isConnected) {
    element.labels = dialogLabels;
    return element;
  }
  element = document.createElement(
    "jant-collection-dialog",
  ) as JantCollectionDialog;
  element.labels = dialogLabels;
  document.body.appendChild(element);
  return element;
}

/**
 * Open the collection dialog.
 *
 * @param options.collectionId - Edit this one; omit to create a new one
 * @returns What happened, and the collection when one was saved
 * @example
 * const { changed } = await openCollectionDialog({ collectionId: "col_…" });
 */
export async function openCollectionDialog(
  options: {
    collectionId?: string;
  } = {},
): Promise<CollectionDialogResult> {
  const dialogLabels = readLabels();
  if (!dialogLabels) return { changed: false };

  return ensureElement(dialogLabels).open(options);
}
