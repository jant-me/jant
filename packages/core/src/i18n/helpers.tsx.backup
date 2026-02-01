/**
 * i18n Helper Functions
 *
 * Simplifies the common pattern of getting i18n and translating messages
 */

import type { MessageDescriptor } from "@lingui/core";
import type { Context } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import { getI18n } from "./i18n.js";

/**
 * Get translation function for a context
 * Note: You still need to use msg() macro - it's required by Lingui to extract messages at compile time
 *
 * @example
 * ```tsx
 * import { msg } from "@lingui/core/macro";
 * import { useT } from "@/i18n";
 *
 * const t = useT(c);
 * return <h1>{t(msg`Dashboard`)}</h1>
 * // or with context
 * return <h1>{t(msg({ message: "Dashboard", comment: "@context: Page title" }))}</h1>
 * ```
 */
export function useT(c: Context) {
  const i18n = getI18n(c);
  return (descriptor: MessageDescriptor, values?: Record<string, any>) => {
    return values ? i18n._(descriptor, values) : i18n._(descriptor);
  };
}

/**
 * Trans component for translating text with embedded JSX components
 * Mimics @lingui/react's Trans component API
 *
 * Usage with useLingui():
 * ```tsx
 * import { t } from "@lingui/core/macro";
 * import { Trans } from "@/i18n";
 *
 * // Components in message string
 * <Trans message={t({ message: "Read the <link>docs</link>", comment: "@context: Help" })}>
 *   <a href="/docs" class="underline" />
 * </Trans>
 *
 * // Multiple components - pass as array in same order
 * <Trans message={t({ message: "Click <bold>here</bold> to <link>learn</link>", comment: "@context: CTA" })}>
 *   <strong />
 *   <a href="/learn" />
 * </Trans>
 * ```
 *
 * Legacy usage with explicit c prop:
 * ```tsx
 * <Trans
 *   c={c}
 *   message={t({ message: "...", comment: "..." })}
 *   components={{ link: <a href="/docs" /> }}
 * />
 * ```
 */
export interface TransProps extends PropsWithChildren {
  c?: Context; // Optional - will use useLingui() if not provided
  message: MessageDescriptor;
  components?: Record<string, FC<any>>; // Legacy: named components
  values?: Record<string, any>;
}

export const Trans: FC<TransProps> = ({ c, message, components, values, children }) => {
  // Get i18n from context or c prop
  let i18n: ReturnType<typeof getI18n>;
  if (c) {
    i18n = getI18n(c);
  } else {
    // Try to use context
    try {
      const { useLingui } = require("./context.js");
      i18n = useLingui().i18n;
    } catch {
      throw new Error("Trans component requires either 'c' prop or I18nProvider wrapper");
    }
  }

  // Get translated string
  const translated = values ? i18n._(message, values) : i18n._(message);

  // If no components and no children, return plain text
  if (!components && !children) {
    return <>{translated}</>;
  }

  // Build components mapping
  let componentMap: Record<string, FC<any>> = {};

  if (components) {
    // Legacy: use named components
    componentMap = components;
  } else if (children) {
    // New API: use children array (like React)
    const childArray = Array.isArray(children) ? children : [children];
    // Map children to numbered placeholders: 0, 1, 2...
    childArray.forEach((child, index) => {
      componentMap[index.toString()] = (() => child) as any;
    });

    // Also support named placeholders by finding tag names in children
    // For now, use index-based mapping
  }

  // Parse and replace component placeholders
  const parts: (string | JSX.Element)[] = [];
  let currentText = translated;
  let key = 0;

  // Simple regex to match <tag>content</tag> or <0>content</0>
  const componentRegex = /<(\w+)>(.*?)<\/\1>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = componentRegex.exec(currentText)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(currentText.slice(lastIndex, match.index));
    }

    const [fullMatch, componentName, content] = match;
    const Component = componentMap[componentName];

    if (Component) {
      // Render component with content as children
      parts.push(<Component key={key++}>{content}</Component>);
    } else {
      // No matching component, keep as-is
      parts.push(fullMatch);
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Add remaining text
  if (lastIndex < currentText.length) {
    parts.push(currentText.slice(lastIndex));
  }

  return <>{parts}</>;
};
