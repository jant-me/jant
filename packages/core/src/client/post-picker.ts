import "./components/jant-post-picker.js";
import type {
  JantPostPicker,
  PostPickerItem,
  PostPickerOptions,
} from "./components/jant-post-picker.js";

const POST_PICKER_TAG = "jant-post-picker";

/**
 * Ensure the shared post picker is mounted once.
 *
 * @returns The mounted picker element
 */
export function ensurePostPicker(): JantPostPicker {
  const existing = document.querySelector<JantPostPicker>(POST_PICKER_TAG);
  if (existing) return existing;

  const picker = document.createElement(POST_PICKER_TAG) as JantPostPicker;
  document.body.appendChild(picker);
  return picker;
}

/**
 * Open the shared picker and resolve to the post the author chose.
 *
 * @param options - Copy, and the search that produces the candidates
 * @returns The picked post's ID, or null when dismissed
 * @example
 * const id = await pickPost({
 *   heading: "Link a translation",
 *   placeholder: "Search your posts…",
 *   emptyHint: "Nothing matched.",
 *   search: (q) => fetchCandidates(q),
 * });
 */
export function pickPost(options: PostPickerOptions): Promise<string | null> {
  return ensurePostPicker().pick(options);
}

export type { PostPickerItem, PostPickerOptions };
