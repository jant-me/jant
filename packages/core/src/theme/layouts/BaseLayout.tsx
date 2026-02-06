/**
 * Base HTML Layout
 *
 * Provides the HTML shell with meta tags, styles, and scripts.
 * If Context is provided, automatically wraps children with I18nProvider.
 *
 * Uses vite-ssr-components for automatic dev/prod asset path resolution.
 */

import type { FC, PropsWithChildren } from "hono/jsx";
import type { Context } from "hono";
import { Script, Link, ViteClient } from "vite-ssr-components/hono";
import { I18nProvider } from "../../i18n/index.js";

export interface BaseLayoutProps {
  title: string;
  description?: string;
  lang?: string;
  c?: Context;
}

export const BaseLayout: FC<PropsWithChildren<BaseLayoutProps>> = ({
  title,
  description,
  lang = "en",
  c,
  children,
}) => {
  // Automatically wrap with I18nProvider if Context is provided
  const content = c ? <I18nProvider c={c}>{children}</I18nProvider> : children;

  return (
    <html lang={lang}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        {description && <meta name="description" content={description} />}
        <ViteClient />
        <Link href="/src/style.css" rel="stylesheet" />
        <Script src="/src/client.ts" />
      </head>
      <body class="bg-background text-foreground antialiased">{content}</body>
    </html>
  );
};
