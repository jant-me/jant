import type { Context } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { I18nProvider } from "../i18n/context.js";
import { getNavigationData } from "./navigation.js";
import { SiteHeader } from "../ui/layouts/SiteLayout.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * Render the current public site header as a replaceable HTML fragment.
 *
 * @param c - Current Hono request context
 * @returns Server-rendered header, drawer backdrop, and mobile drawer HTML
 *
 * @example
 * ```typescript
 * const headerHtml = await renderSiteHeaderHtml(c);
 * return c.json({ headerHtml });
 * ```
 */
export async function renderSiteHeaderHtml(c: Context<Env>): Promise<string> {
  const navData = await getNavigationData(c, { includeCollections: false });

  return String(
    <I18nProvider c={c}>
      <SiteHeader
        siteName={navData.siteName}
        links={navData.links}
        currentPath={navData.currentPath}
        sitePathPrefix={navData.sitePathPrefix}
        basePath={navData.basePath}
        siteAvatarThumbUrl={navData.siteAvatarThumbUrl}
        showHeaderAvatar={navData.showHeaderAvatar}
      />
    </I18nProvider>,
  );
}
