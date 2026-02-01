/**
 * Hono JSX i18n Context System
 *
 * Mimics React's Context API for Hono JSX to provide i18n without prop drilling
 */

import type { Context } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { getI18n as getI18nFromContext } from "./i18n.js";

// Store i18n instance during render
let currentI18n: I18n | null = null;

/**
 * I18nProvider - wraps your app to provide i18n context
 *
 * @example
 * ```tsx
 * import { I18nProvider } from "@/i18n";
 *
 * return c.html(
 *   <I18nProvider c={c}>
 *     <YourApp />
 *   </I18nProvider>
 * );
 * ```
 */
export interface I18nProviderProps extends PropsWithChildren {
  c: Context;
}

export const I18nProvider: FC<I18nProviderProps> = ({ c, children }) => {
  // Set current i18n for this render
  const previousI18n = currentI18n;
  currentI18n = getI18nFromContext(c);

  try {
    // Render children
    const result = <>{children}</>;
    return result;
  } finally {
    // Restore previous i18n
    currentI18n = previousI18n;
  }
};

/**
 * useLingui hook - get i18n instance and translation function
 * Mimics @lingui/react's useLingui() API
 *
 * @example
 * ```tsx
 * import { t } from "@lingui/core/macro";
 * import { useLingui } from "@/i18n";
 *
 * function MyComponent() {
 *   const { t: _ } = useLingui();  // Use _ to avoid conflict with macro
 *
 *   return (
 *     <div>
 *       <h1>{_(t({ message: "Dashboard", comment: "@context: Page title" }))}</h1>
 *     </div>
 *   );
 * }
 * ```
 *
 * Or use the i18n instance directly:
 * ```tsx
 * const { i18n } = useLingui();
 * i18n._(t({ message: "Dashboard", comment: "@context: Page title" }))
 * ```
 */
export function useLingui() {
  if (!currentI18n) {
    throw new Error(
      "useLingui() called outside of I18nProvider. " +
      "Make sure your component is wrapped in <I18nProvider c={c}>...</I18nProvider>"
    );
  }

  // Create translation function that accepts MessageDescriptor
  const translate = (descriptor: MessageDescriptor, values?: Record<string, any>) => {
    return values ? currentI18n!._(descriptor, values) : currentI18n!._(descriptor);
  };

  return {
    i18n: currentI18n,
    // t function - can be used with t macro from @lingui/core/macro
    t: translate,
    // _ is an alias for t (shorter)
    _: translate,
  };
}
