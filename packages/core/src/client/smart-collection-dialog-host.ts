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

let labels: SmartCollectionDialogLabels | null = null;
let element: JantSmartCollectionDialog | null = null;
let collections: Promise<SiteCollection[]> | null = null;

interface SiteCollection {
  id: string;
  slug: string;
  title: string;
}

/**
 * The dialog's strings, rendered into the page by whichever surface can open
 * it. Read once and cached: they are the same on every surface of a page, and
 * the collection vocabulary is written into this object once it loads.
 */
function readLabels(): SmartCollectionDialogLabels | null {
  if (labels) return labels;
  const holder = document.querySelector<HTMLElement>(`[${LABELS_ATTRIBUTE}]`);
  const raw = holder?.getAttribute(LABELS_ATTRIBUTE);
  if (!raw) return null;
  try {
    labels = JSON.parse(raw) as SmartCollectionDialogLabels;
    return labels;
  } catch {
    return null;
  }
}

/**
 * Load the site's collections so the collection condition can offer them.
 *
 * Fetched at most once per page, and only when the dialog is actually opened —
 * most page loads never open it. The names are written into the labels on every
 * open rather than only on the first: an opened-once flag would leave the
 * second open with a collection menu that lists nothing.
 */
async function ensureCollectionVocabulary(
  target: SmartCollectionDialogLabels,
): Promise<void> {
  collections ??= fetchCollections();
  const loaded = await collections;
  setCollectionVocabulary(loaded);
  for (const collection of loaded) {
    target.values[`collection.${collection.slug}`] = collection.title;
  }
}

async function fetchCollections(): Promise<SiteCollection[]> {
  try {
    const res = await fetch(publicPath("/api/collections"));
    if (!res.ok) return [];
    const json = (await res.json()) as { collections?: SiteCollection[] };
    return json.collections ?? [];
  } catch {
    // The condition is still offered; it simply lists nothing to choose.
    return [];
  }
}

function ensureElement(
  dialogLabels: SmartCollectionDialogLabels,
): JantSmartCollectionDialog {
  if (element?.isConnected) {
    element.labels = dialogLabels;
    return element;
  }
  element = document.createElement(
    "jant-smart-collection-dialog",
  ) as JantSmartCollectionDialog;
  element.labels = dialogLabels;
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
  const dialogLabels = readLabels();
  if (!dialogLabels) return false;

  await ensureCollectionVocabulary(dialogLabels);
  const dialog = ensureElement(dialogLabels);
  return dialog.open(options);
}
