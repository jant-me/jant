import type { FC } from "hono/jsx";
import {
  COPY_FIELD_BUTTON_ATTR,
  COPY_FIELD_BUTTON_CLASS,
  COPY_FIELD_CLASS,
  COPY_FIELD_CONTROL_CLASS,
  COPY_FIELD_FAILED_ATTR,
  COPY_FIELD_INPUT_CLASS,
  COPY_FIELD_VALUE_ATTR,
} from "../../lib/copy-field.js";

export interface CopyFieldProps {
  /** Field label, also the input's accessible name. */
  label: string;
  /** The address to show and copy. Absolute — it is meant to leave this page. */
  value: string;
  /** Optional line under the label saying what this address gives you. */
  description?: string;
  /** Text on the copy button. */
  copyLabel: string;
  /** Toast shown after a successful copy. */
  copiedMessage: string;
  /** Toast shown when the clipboard is unavailable or refuses. */
  failedMessage: string;
}

/**
 * A read-only address with a copy button.
 *
 * Rendered whole on the server: the address is the content of the page this
 * appears on, so it must not wait for JavaScript. `client/copy-field.ts` adds
 * the copying and reveals the button, which ships hidden so that without the
 * script the field degrades to an input the reader can select by hand rather
 * than a button that does nothing.
 *
 * @param props - Label, address, and the strings the client needs for toasts
 * @returns The field markup
 * @example
 * <CopyField
 *   label="Main feed"
 *   value="https://example.com/feed"
 *   copyLabel="Copy"
 *   copiedMessage="Feed URL copied."
 *   failedMessage="Could not copy. Select the address and copy it."
 * />
 */
export const CopyField: FC<CopyFieldProps> = ({
  label,
  value,
  description,
  copyLabel,
  copiedMessage,
  failedMessage,
}) => (
  <div class={COPY_FIELD_CLASS} data-copy-field-root>
    <p class="text-sm font-medium">{label}</p>
    {description ? (
      <p class="text-sm text-muted-foreground">{description}</p>
    ) : null}
    <div class={COPY_FIELD_CONTROL_CLASS}>
      <input
        type="text"
        class={COPY_FIELD_INPUT_CLASS}
        value={value}
        readonly
        aria-label={label}
        {...{ [COPY_FIELD_VALUE_ATTR]: "" }}
      />
      <button
        type="button"
        class={COPY_FIELD_BUTTON_CLASS}
        hidden
        {...{
          [COPY_FIELD_BUTTON_ATTR]: copiedMessage,
          [COPY_FIELD_FAILED_ATTR]: failedMessage,
        }}
      >
        {copyLabel}
      </button>
    </div>
  </div>
);
