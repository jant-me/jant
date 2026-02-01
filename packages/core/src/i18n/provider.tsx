/**
 * I18nProvider for Hono JSX
 * SSR-compatible implementation without React hooks
 */

import type { Context } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import { getI18n } from "./i18n.js";
import { setI18nContext } from "./context.js";

export interface I18nProviderProps extends PropsWithChildren {
  c: Context;
}

/**
 * I18nProvider - wraps your app to provide i18n context
 * Works with Hono JSX SSR (no React hooks required)
 *
 * Sets the global i18n context before rendering.
 * Note: Assumes synchronous rendering (which Hono JSX does).
 *
 * @example
 * ```tsx
 * import { I18nProvider } from "@/i18n";
 * import { useLingui } from "@/i18n";
 *
 * dashRoute.get("/", async (c) => {
 *   return c.html(
 *     <I18nProvider c={c}>
 *       <YourApp />
 *     </I18nProvider>
 *   );
 * });
 * ```
 */
export const I18nProvider: FC<I18nProviderProps> = ({ c, children }) => {
  const i18n = getI18n(c);

  // Set global context (synchronous rendering)
  setI18nContext(i18n);

  return <>{children}</>;
};
