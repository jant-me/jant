/**
 * Smart collection dialog host.
 *
 * One dialog element for the whole page, mounted lazily and reused. Three
 * places open it — the collections page menu, a directory row's menu, and the
 * smart collection page's own menu — and they all go through
 * {@link openSmartCollectionDialog}, because creating and editing are one
 * surface.
 */

import "./components/jant-smart-collection-dialog.js";
import type { JantSmartCollectionDialog } from "./components/jant-smart-collection-dialog.js";
import type {
  SmartCollectionDialogLabels,
  SmartCollectionDialogState,
} from "./components/smart-collection-dialog-types.js";
import { setCollectionVocabulary } from "./components/smart-collection-conditions.js";
import { publicPath } from "./runtime-paths.js";

const LABELS_ATTRIBUTE = "data-smart-collection-dialog-labels";

/**
 * The dialog's strings, rendered into the page by whichever surface can open
 * it. Read once and cached: they are the same on every surface of a page.
 */
function readLabels(): SmartCollectionDialogLabels | null {
  const holder = document.querySelector<HTMLElement>(`[${LABELS_ATTRIBUTE}]`);
  const raw = holder?.getAttribute(LABELS_ATTRIBUTE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SmartCollectionDialogLabels;
  } catch {
    return null;
  }
}

let element: JantSmartCollectionDialog | null = null;
let vocabularyLoaded = false;

/**
 * Load the site's collections so the collection condition can offer them.
 *
 * Done once per page and only when the dialog is actually opened — most page
 * loads never open it.
 */
async function ensureCollectionVocabulary(
  labels: SmartCollectionDialogLabels,
): Promise<void> {
  if (vocabularyLoaded) return;
  vocabularyLoaded = true;
  try {
    const res = await fetch(publicPath("/api/collections"));
    if (!res.ok) return;
    const json = (await res.json()) as {
      collections?: Array<{ id: string; slug: string; title: string }>;
    };
    const collections = json.collections ?? [];
    setCollectionVocabulary(collections);
    for (const collection of collections) {
      labels.values[`collection.${collection.slug}`] = collection.title;
    }
  } catch {
    // The condition is still offered; it simply lists nothing to choose.
  }
}

function ensureElement(
  labels: SmartCollectionDialogLabels,
): JantSmartCollectionDialog {
  if (element?.isConnected) {
    element.labels = labels;
    return element;
  }
  element = document.createElement(
    "jant-smart-collection-dialog",
  ) as JantSmartCollectionDialog;
  element.labels = labels;
  document.body.appendChild(element);
  return element;
}

/**
 * Open the smart collection dialog.
 *
 * @param options.smartCollectionId - Edit this one; omit to create a new one
 * @param options.prefill - Starting values, shown to the author before anything
 *   is saved
 * @returns Whether anything was created, changed, or deleted
 * @example
 * await openSmartCollectionDialog({ smartCollectionId: "smc_…" });
 */
export async function openSmartCollectionDialog(options: {
  smartCollectionId?: string;
  prefill?: SmartCollectionDialogState;
}): Promise<boolean> {
  const labels = readLabels();
  if (!labels) return false;

  await ensureCollectionVocabulary(labels);
  const dialog = ensureElement(labels);
  return dialog.open(options);
}
