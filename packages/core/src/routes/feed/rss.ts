/**
 * RSS Feed Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const rssRoutes = new Hono<Env>();

// RSS 2.0 Feed - main feed at /feed
rssRoutes.get("/", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const siteDescription = (await c.var.services.settings.get("SITE_DESCRIPTION")) ?? "";
  const siteUrl = c.env.SITE_URL;

  const posts = await c.var.services.posts.list({
    visibility: ["featured", "quiet"],
    limit: 50,
  });

  const items = posts
    .map((post) => {
      const link = `${siteUrl}/p/${sqid.encode(post.id)}`;
      const title = post.title || `Post #${post.id}`;
      const pubDate = new Date(post.publishedAt * 1000).toUTCString();

      return `
    <item>
      <title><![CDATA[${escapeXml(title)}]]></title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${post.contentHtml || ""}]]></description>
    </item>`;
    })
    .join("");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteName)}</title>
    <link>${siteUrl}</link>
    <description>${escapeXml(siteDescription)}</description>
    <language>en</language>
    <atom:link href="${siteUrl}/feed" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
});

// Atom Feed
rssRoutes.get("/atom.xml", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const siteDescription = (await c.var.services.settings.get("SITE_DESCRIPTION")) ?? "";
  const siteUrl = c.env.SITE_URL;

  const posts = await c.var.services.posts.list({
    visibility: ["featured", "quiet"],
    limit: 50,
  });

  const entries = posts
    .map((post) => {
      const link = `${siteUrl}/p/${sqid.encode(post.id)}`;
      const title = post.title || `Post #${post.id}`;
      const updated = time.toISOString(post.updatedAt);
      const published = time.toISOString(post.publishedAt);

      return `
  <entry>
    <title>${escapeXml(title)}</title>
    <link href="${link}" rel="alternate"/>
    <id>${link}</id>
    <published>${published}</published>
    <updated>${updated}</updated>
    <content type="html"><![CDATA[${post.contentHtml || ""}]]></content>
  </entry>`;
    })
    .join("");

  const now = time.toISOString(time.now());

  const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(siteName)}</title>
  <subtitle>${escapeXml(siteDescription)}</subtitle>
  <link href="${siteUrl}" rel="alternate"/>
  <link href="${siteUrl}/feed/atom.xml" rel="self"/>
  <id>${siteUrl}/</id>
  <updated>${now}</updated>
  ${entries}
</feed>`;

  return new Response(atom, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
    },
  });
});

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
