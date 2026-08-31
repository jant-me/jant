/**
 * Copy field contract.
 *
 * A copy field is a read-only text input holding an address, with a button that
 * puts it on the clipboard. It is rendered from two places — server JSX on the
 * public subscribe page, a Lit template in General settings — so the hooks the
 * client enhancer looks for and the classes that give the two the same shape
 * are declared once, here, rather than written out twice.
 *
 * The behavior lives in `client/copy-field.ts`.
 */

/** Marks the button. Its value is the toast shown after a successful copy. */
export const COPY_FIELD_BUTTON_ATTR = "data-copy-field";

/** On the button. Its value is the toast shown when the clipboard refuses. */
export const COPY_FIELD_FAILED_ATTR = "data-copy-field-failed";

/** Marks the input holding the address to copy. */
export const COPY_FIELD_VALUE_ATTR = "data-copy-field-value";

/**
 * The address input. Monospaced because these are URLs read character by
 * character, and right-padded to clear the button sitting on top of it.
 */
export const COPY_FIELD_INPUT_CLASS = "input w-full pr-20 font-mono text-sm";

/** The button, laid over the input's right edge. */
export const COPY_FIELD_BUTTON_CLASS =
  "btn-sm-outline absolute right-2 top-1/2 h-7 -translate-y-1/2 px-2.5 text-xs";

/** Wraps input and button so the button can be positioned against the input. */
export const COPY_FIELD_CONTROL_CLASS = "relative";

/** Wraps the whole field: label, optional description, then the control. */
export const COPY_FIELD_CLASS = "flex min-w-0 flex-col gap-1";
