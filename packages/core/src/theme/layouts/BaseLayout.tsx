/**
 * Base HTML Layout
 *
 * Provides the HTML shell with meta tags, styles, and scripts.
 * If Context is provided, automatically wraps children with I18nProvider.
 */

import type { FC, PropsWithChildren } from "hono/jsx";
import type { Context } from "hono";
import { getAssets } from "../../lib/assets.js";
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
  // Get assets at render time (supports runtime manifest loading)
  const assets = getAssets();

  // Automatically wrap with I18nProvider if Context is provided
  const content = c ? <I18nProvider c={c}>{children}</I18nProvider> : children;

  return (
    <html lang={lang}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        {description && <meta name="description" content={description} />}
        <link rel="stylesheet" href={assets.styles} />
        <script type="module" src={assets.client} defer />
        <script type="module" src={assets.datastar} defer />
      </head>
      <body class="bg-background text-foreground antialiased">
        {content}
      </body>
    </html>
  );
};
