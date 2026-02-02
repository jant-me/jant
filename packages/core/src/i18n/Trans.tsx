/**
 * Trans Component for Hono JSX
 *
 * Simple implementation that just renders children directly.
 * For complex translations with embedded JSX, use the t() function with placeholders.
 */

import type { FC, PropsWithChildren } from "hono/jsx";

export interface TransProps extends PropsWithChildren {
  comment?: string;
  id?: string;
}

/**
 * Trans component - renders children as-is
 * Note: This is a simplified implementation. For translations with embedded JSX,
 * it's recommended to use t() with placeholders instead.
 *
 * @example
 * ```tsx
 * <Trans comment="@context: Help text">
 *   Visit the <a href="/docs">documentation</a>
 * </Trans>
 * ```
 */
export const Trans: FC<TransProps> = ({ children }) => {
  // In a full implementation, this would extract and translate the content
  // For now, we just render children as-is (works for English/default locale)
  return <>{children}</>;
};
