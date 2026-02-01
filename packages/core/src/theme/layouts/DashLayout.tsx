/**
 * Dashboard Layout
 *
 * Layout for admin dashboard pages
 */

import type { FC, PropsWithChildren } from "hono/jsx";
import type { Context } from "hono";
import { useLingui } from "../../i18n/index.js";
import { BaseLayout } from "./BaseLayout.js";

export interface DashLayoutProps {
  c: Context;
  title: string;
  siteName: string;
  currentPath?: string;
}

interface NavItem {
  href: string;
  labelKey: string;
  comment: string;
  match?: RegExp;
}

const navItems: NavItem[] = [
  { href: "/dash", labelKey: "Dashboard", comment: "@context: Dashboard navigation - main dashboard page", match: /^\/dash$/ },
  { href: "/dash/posts", labelKey: "Posts", comment: "@context: Dashboard navigation - posts management", match: /^\/dash\/posts/ },
  { href: "/dash/pages", labelKey: "Pages", comment: "@context: Dashboard navigation - pages management", match: /^\/dash\/pages/ },
  { href: "/dash/media", labelKey: "Media", comment: "@context: Dashboard navigation - media library", match: /^\/dash\/media/ },
  { href: "/dash/collections", labelKey: "Collections", comment: "@context: Dashboard navigation - collections management", match: /^\/dash\/collections/ },
  { href: "/dash/redirects", labelKey: "Redirects", comment: "@context: Dashboard navigation - URL redirects", match: /^\/dash\/redirects/ },
  { href: "/dash/settings", labelKey: "Settings", comment: "@context: Dashboard navigation - site settings", match: /^\/dash\/settings/ },
];

function DashLayoutContent({
  title,
  siteName,
  currentPath,
  children,
}: PropsWithChildren<Omit<DashLayoutProps, "c">>) {
  const { t } = useLingui();

  const isActive = (item: NavItem) => {
    if (!currentPath) return false;
    if (item.match) return item.match.test(currentPath);
    return currentPath === item.href;
  };

  return (
    <div class="min-h-screen">
      {/* Header */}
      <header class="border-b bg-card">
        <div class="container flex h-14 items-center justify-between">
          <a href="/dash" class="font-semibold">
            {siteName}
          </a>
          <nav class="flex items-center gap-4">
            <a href="/" class="text-sm text-muted-foreground hover:text-foreground">
              {t({ message: "View Site", comment: "@context: Dashboard header link to view the public site" })}
            </a>
            <a href="/signout" class="text-sm text-muted-foreground hover:text-foreground">
              {t({ message: "Sign Out", comment: "@context: Dashboard header link to sign out" })}
            </a>
          </nav>
        </div>
      </header>

      {/* Sidebar + Main */}
      <div class="container flex gap-8 py-8">
        {/* Sidebar */}
        <aside class="w-48 shrink-0">
          <nav class="flex flex-col gap-1">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                class={`justify-start px-3 py-2 text-sm rounded-md ${
                  isActive(item)
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {t({ message: item.labelKey, comment: item.comment })}
              </a>
            ))}
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
      <DashLayoutContent title={title} siteName={siteName} currentPath={currentPath}>
        {children}
      </DashLayoutContent>
    </BaseLayout>
  );
};
