/**
 * Dashboard Layout
 *
 * Layout for admin dashboard pages
 */

import type { FC, PropsWithChildren } from "hono/jsx";
import { BaseLayout } from "./BaseLayout.js";

export interface DashLayoutProps {
  title: string;
  siteName: string;
}

export const DashLayout: FC<PropsWithChildren<DashLayoutProps>> = ({
  title,
  siteName,
  children,
}) => {
  return (
    <BaseLayout title={`${title} - ${siteName}`}>
      <div class="min-h-screen">
        {/* Header */}
        <header class="border-b bg-card">
          <div class="container flex h-14 items-center justify-between">
            <a href="/dash" class="font-semibold">
              {siteName}
            </a>
            <nav class="flex items-center gap-4">
              <a href="/" class="text-sm text-muted-foreground hover:text-foreground">
                View Site
              </a>
              <a href="/signout" class="text-sm text-muted-foreground hover:text-foreground">
                Sign Out
              </a>
            </nav>
          </div>
        </header>

        {/* Sidebar + Main */}
        <div class="container flex gap-8 py-8">
          {/* Sidebar */}
          <aside class="w-48 shrink-0">
            <nav class="flex flex-col gap-1">
              <a href="/dash" class="btn-ghost justify-start px-3 py-2 text-sm">
                Dashboard
              </a>
              <a href="/dash/posts" class="btn-ghost justify-start px-3 py-2 text-sm">
                Posts
              </a>
              <a href="/dash/pages" class="btn-ghost justify-start px-3 py-2 text-sm">
                Pages
              </a>
              <a href="/dash/collections" class="btn-ghost justify-start px-3 py-2 text-sm">
                Collections
              </a>
              <a href="/dash/redirects" class="btn-ghost justify-start px-3 py-2 text-sm">
                Redirects
              </a>
              <a href="/dash/settings" class="btn-ghost justify-start px-3 py-2 text-sm">
                Settings
              </a>
            </nav>
          </aside>

          {/* Main content */}
          <main class="flex-1 min-w-0">{children}</main>
        </div>
      </div>
    </BaseLayout>
  );
};
