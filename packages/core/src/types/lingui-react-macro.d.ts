/**
 * Type declarations for @lingui/react/macro
 *
 * @lingui/react is not installed (it requires React as a peer dependency),
 * but the SWC Lingui plugin recognizes imports from @lingui/react/macro and
 * rewrites them via runtimeConfigModule to our custom Hono JSX implementation.
 *
 * These declarations satisfy TypeScript for the pre-transformation API surface.
 */

declare module "@lingui/react/macro" {
  import type { I18n } from "@lingui/core";
  import type { FC, PropsWithChildren } from "hono/jsx";

  interface TranslationDescriptor {
    id?: string;
    message: string;
    comment?: string;
    values?: Record<string, unknown>;
  }

  export function useLingui(): {
    t: (descriptor: TranslationDescriptor) => string;
    _: (descriptor: TranslationDescriptor) => string;
    i18n: I18n;
  };

  export const Trans: FC<
    PropsWithChildren<{
      comment?: string;
      id?: string;
    }>
  >;
}
