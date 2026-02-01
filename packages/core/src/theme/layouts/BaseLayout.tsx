/**
 * Base HTML Layout
 *
 * Provides the HTML shell with meta tags, styles, and scripts
 */

import type { FC, PropsWithChildren } from "hono/jsx";
import { ASSETS } from "../../lib/assets.js";

export interface BaseLayoutProps {
  title: string;
  description?: string;
  lang?: string;
}

export const BaseLayout: FC<PropsWithChildren<BaseLayoutProps>> = ({
  title,
  description,
  lang = "en",
  children,
}) => {
  return (
    <html lang={lang}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        {description && <meta name="description" content={description} />}
        <link rel="stylesheet" href={ASSETS.styles} />
        <script type="module" src={ASSETS.datastar} defer />
      </head>
      <body class="bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
};
