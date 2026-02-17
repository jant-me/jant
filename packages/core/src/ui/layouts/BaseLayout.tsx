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

export interface ToastProps {
  message: string;
  type?: "success" | "error";
}

export interface BaseLayoutProps {
  title: string;
  description?: string;
  lang?: string;
  c?: Context;
  toast?: ToastProps;
  faviconUrl?: string;
  noindex?: boolean;
}

export const BaseLayout: FC<PropsWithChildren<BaseLayoutProps>> = ({
  title,
  description,
  lang,
  c,
  toast,
  faviconUrl,
  noindex,
  children,
}) => {
  // Read lang from Hono context if available, otherwise use prop or default
  const resolvedLang = lang ?? (c ? c.get("lang") : "en");

  // Read faviconUrl from context when not provided as prop (fixes dashboard favicon)
  const resolvedFaviconUrl = faviconUrl ?? (c ? c.get("faviconUrl") : undefined);

  // Read noindex from context when not provided as prop
  const resolvedNoindex = noindex ?? (c ? c.get("noindex") : undefined);

  // Automatically wrap with I18nProvider if Context is provided
  const content = c ? <I18nProvider c={c}>{children}</I18nProvider> : children;

  // Read theme style from Hono context if available
  const themeStyle = c ? c.get("themeStyle") : undefined;

  // Read custom CSS from Hono context if available
  const customCSS = c ? c.get("customCSS") : undefined;

  // Check authentication status for data attribute
  const isAuthenticated = c ? c.get("isAuthenticated") : false;

  return (
    <html lang={resolvedLang}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        {description && <meta name="description" content={description} />}
        {resolvedNoindex && <meta name="robots" content="noindex, nofollow" />}
        {resolvedFaviconUrl && (
          <>
            <link rel="icon" href="/favicon.ico" sizes="16x16 32x32" />
            <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
          </>
        )}
        <ViteClient />
        <Link href="/src/style.css" rel="stylesheet" />
        {themeStyle && <style>{themeStyle}</style>}
        {customCSS && <style>{customCSS}</style>}
        <Script src="/src/client.ts" />
      </head>
      <body
        class="bg-background text-foreground antialiased"
        {...(isAuthenticated ? { "data-authenticated": true } : {})}
      >
        {content}
        <div id="toast-container" class="toast-container">
          {toast && (
            <div
              class={`toast ${toast.type === "error" ? "toast-error" : "toast-success"}`}
              data-init="history.replaceState({}, '', location.pathname); setTimeout(() => { el.classList.add('toast-out'); el.addEventListener('animationend', () => el.remove()) }, 3000)"
            >
              {toast.type === "error" ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  stroke="currentColor"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="m15 9-6 6M9 9l6 6" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  stroke="currentColor"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              )}
              <span>{toast.message}</span>
              <button
                class="toast-close"
                data-on:click="el.closest('.toast').classList.add('toast-out'); el.closest('.toast').addEventListener('animationend', () => el.closest('.toast').remove())"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  stroke="currentColor"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </body>
    </html>
  );
};
