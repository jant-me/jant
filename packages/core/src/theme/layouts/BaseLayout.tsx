/**
 * Base HTML Layout
 *
 * Provides the HTML shell with meta tags, styles, and scripts
 */

import type { FC, PropsWithChildren } from "hono/jsx";

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
        <style>{`
          @import "tailwindcss";
          @import "basecoat-css";
          :root { --radius: 0.5rem; }
          .container { max-width: 42rem; margin: 0 auto; padding: 0 1rem; }
        `}</style>
        <script src="/assets/datastar.min.js" defer />
      </head>
      <body class="bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
};
