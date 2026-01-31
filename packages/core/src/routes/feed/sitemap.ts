/**
 * Sitemap Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const sitemapRoutes = new Hono<Env>();

// XML Sitemap
sitemapRoutes.get("/sitemap.xml", async (c) => {
  const siteUrl = c.env.SITE_URL;

  const posts = await c.var.services.posts.list({
    visibility: ["featured", "quiet"],
    limit: 1000,
  });

  const urls = posts
    .map((post) => {
      const loc = `${siteUrl}/p/${sqid.encode(post.id)}`;
      const lastmod = time.toISOString(post.updatedAt).split("T")[0];
      const priority = post.visibility === "featured" ? "0.8" : "0.6";

      return `
  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <priority>${priority}</priority>
  </url>`;
    })
    .join("");

  // Add homepage
  const homepageUrl = `
  <url>
    <loc>${siteUrl}/</loc>
    <priority>1.0</priority>
    <changefreq>daily</changefreq>
  </url>`;

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${homepageUrl}
  ${urls}
</urlset>`;

  return new Response(sitemap, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
});

// robots.txt
sitemapRoutes.get("/robots.txt", (c) => {
  const siteUrl = c.env.SITE_URL;

  const robots = `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;

  return new Response(robots, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
});
