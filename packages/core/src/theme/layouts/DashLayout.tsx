/**
 * Dashboard Layout
 *
 * Layout for admin dashboard pages
 */

import type { FC, PropsWithChildren } from "hono/jsx";
import type { Context } from "hono";
import { useLingui } from "@lingui/react/macro";
import { BaseLayout } from "./BaseLayout.js";

export interface DashLayoutProps {
  c: Context;
  title: string;
  siteName: string;
  currentPath?: string;
}

function DashLayoutContent({
  siteName,
  currentPath,
  children,
}: PropsWithChildren<Omit<DashLayoutProps, "c" | "title">>) {
  const { t } = useLingui();

  const isActive = (path: string, match?: RegExp) => {
    if (!currentPath) return false;
    if (match) return match.test(currentPath);
    return currentPath === path;
  };

  const navClass = (path: string, match?: RegExp) =>
    `justify-start px-3 py-2 text-sm rounded-md ${
      isActive(path, match)
        ? "bg-accent text-accent-foreground font-medium"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    }`;

  return (
    <div class="min-h-screen">
      {/* Header */}
      <header class="border-b bg-card">
        <div class="container flex h-14 items-center justify-between">
          <a href="/dash" class="font-semibold">
            {siteName}
          </a>
          <nav class="flex items-center gap-4">
            <a
              href="/"
              class="text-sm text-muted-foreground hover:text-foreground"
            >
              {t({
                message: "View Site",
                comment:
                  "@context: Dashboard header link to view the public site",
              })}
            </a>
            <a
              href="/signout"
              class="text-sm text-muted-foreground hover:text-foreground"
            >
              {t({
                message: "Sign Out",
                comment: "@context: Dashboard header link to sign out",
              })}
            </a>
          </nav>
        </div>
      </header>

      {/* Sidebar + Main */}
      <div class="container flex gap-8 py-8">
        {/* Sidebar */}
        <aside class="w-48 shrink-0">
          <nav class="flex flex-col gap-1">
            <a href="/dash" class={navClass("/dash", /^\/dash$/)}>
              {t({
                message: "Dashboard",
                comment: "@context: Dashboard navigation - main dashboard page",
              })}
            </a>
            <a
              href="/dash/posts"
              class={navClass("/dash/posts", /^\/dash\/posts/)}
            >
              {t({
                message: "Posts",
                comment: "@context: Dashboard navigation - posts management",
              })}
            </a>
            <a
              href="/dash/pages"
              class={navClass("/dash/pages", /^\/dash\/pages/)}
            >
              {t({
                message: "Pages",
                comment: "@context: Dashboard navigation - pages management",
              })}
            </a>
            <a
              href="/dash/media"
              class={navClass("/dash/media", /^\/dash\/media/)}
            >
              {t({
                message: "Media",
                comment: "@context: Dashboard navigation - media library",
              })}
            </a>
            <a
              href="/dash/collections"
              class={navClass("/dash/collections", /^\/dash\/collections/)}
            >
              {t({
                message: "Collections",
                comment:
                  "@context: Dashboard navigation - collections management",
              })}
            </a>
            <a
              href="/dash/redirects"
              class={navClass("/dash/redirects", /^\/dash\/redirects/)}
            >
              {t({
                message: "Redirects",
                comment: "@context: Dashboard navigation - URL redirects",
              })}
            </a>
            <a
              href="/dash/settings"
              class={navClass("/dash/settings", /^\/dash\/settings/)}
            >
              {t({
                message: "Settings",
                comment: "@context: Dashboard navigation - site settings",
              })}
            </a>
          </nav>
        </aside>

        {/* Main content */}
        <main class="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

export const DashLayout: FC<PropsWithChildren<DashLayoutProps>> = ({
  c,
  title,
  siteName,
  currentPath,
  children,
}) => {
  return (
    <BaseLayout title={`${title} - ${siteName}`} c={c}>
      <DashLayoutContent siteName={siteName} currentPath={currentPath}>
        {children}
      </DashLayoutContent>
    </BaseLayout>
  );
};
