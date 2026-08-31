import type { FC } from "hono/jsx";
import { getIconSvg } from "../../lib/icons.js";
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
  /**
   * Optional page this address is the feed of, linked from the label.
   *
   * A feed lives at `{page}/feed`, so every address here has a page whose
   * contents it carries. Linking the label lets a reader look at those posts
   * before subscribing — the page is the only honest preview of the feed.
   * Omitted (settings, where the author already knows the site) the label
   * stays plain text.
   */
  labelHref?: string;
  /**
   * Tooltip for the linked label, saying what following it does. The link text
   * is the feed's name ("Latest", "All"), which alone does not tell a reader
   * that it leads to a page — and `title` supplements the accessible name
   * rather than replacing it, so the visible text still wins.
   */
  labelTitle?: string;
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
  labelHref,
  labelTitle,
  value,
  description,
  copyLabel,
  copiedMessage,
  failedMessage,
}) => (
  <div class={COPY_FIELD_CLASS} data-copy-field-root>
    <p class="text-sm font-medium">
      {labelHref ? (
        // The affordance is the arrow, not an underline. Three underlined
        // labels stacked over three inputs read as a mis-styled form, and the
        // rule under a two-word label is heavy enough to compete with the
        // address it introduces. An arrow is visible at rest — which the
        // underline was there to be — and says where the link goes besides.
        // The underline still arrives on hover, where it costs nothing.
        <a
          href={labelHref}
          title={labelTitle}
          class="group inline-flex items-center gap-1 underline-offset-4 hover:underline focus-visible:underline"
        >
          {label}
          <span
            class="text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5"
            aria-hidden="true"
            dangerouslySetInnerHTML={{
              __html: getIconSvg("arrow-right", "size-3.5 icon-fine") ?? "",
            }}
          />
        </a>
      ) : (
        label
      )}
    </p>
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
