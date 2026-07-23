/**
 * Catch-all Route
 *
 * Resolves post slugs, aliases, redirects, and collection aliases.
 * Must be registered last.
 */

import { msg } from "@lingui/core/macro";
import { Hono, type Context } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { getI18n } from "../../i18n/index.js";
import { requireAuth } from "../../middleware/auth.js";
import { PostPage } from "../../ui/pages/PostPage.js";
import { DraftPreviewBar } from "../../ui/shared/DraftPreviewBar.js";
import { getNavigationData } from "../../lib/navigation.js";
import { renderPublicPage } from "../../lib/render.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { buildPostMeta } from "../../lib/post-meta.js";
import { isReservedPath } from "../../lib/constants.js";
import {
  assemblePostPageDisplay,
  type PostPageDisplayData,
} from "../../lib/post-display.js";
import { buildArticleJsonLd } from "../../lib/structured-data.js";
import {
  toAbsoluteAssetUrl,
  toPublicHref,
  toPublicPath,
} from "../../lib/url.js";
import { ABOUT_PAGE_SLUG } from "../../services/about-page.js";
import { isTextAttachment } from "../../services/media.js";
import type { Post } from "../../types.js";
import { renderArchivePage } from "./archive.js";
import { renderCollectionFeed, renderCollectionPage } from "./collection.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const pageRoutes = new Hono<Env>();

interface TextPreviewAutoOpen {
  html: string;
  shareHref: string;
  postHref: string;
  /** Attachment summary used as page title for link previews */
  attachmentTitle: string;
  /** Media ID so the dialog can lazy-fetch the markdown source for Copy */
  mediaId: string;
}

/**
 * Build the canonical absolute URL for a post page.
 *
 * Reply URLs render the full thread, so search engines see overlapping
 * content at every reply URL. Point the canonical to the thread root so
 * crawlers consolidate ranking on one URL.
 *
 * The root post is always at index 0 of `threadPostViews` (getThread orders
 * by createdAt ASC, and the DB check constraint guarantees root has the
 * smallest createdAt in its thread). When `threadPostViews` is undefined the
 * post is not part of a multi-post thread, so the post itself is the root.
 */
function buildPostCanonicalHref(
  postView: { permalink: string },
  threadPostViews: Array<{ permalink: string }> | undefined,
  siteUrl: string,
): string {
  const rootPermalink = threadPostViews?.[0]?.permalink ?? postView.permalink;
  if (!siteUrl) return rootPermalink;
  return new URL(rootPermalink, siteUrl).toString();
}

/**
 * Build the `BlogPosting` JSON-LD for a post page. The post page renders the
 * whole thread, so the structured data describes the thread as one article:
 * canonical URL, root publish time, latest thread modification time.
 */
function buildPostJsonLd(
  c: Context<Env>,
  display: PostPageDisplayData,
  meta: { title: string; description?: string },
  canonicalHref: string,
  siteName: string,
): Record<string, unknown> {
  const { siteUrl, sitePathPrefix } = c.var.appConfig;
  const imageUrl = display.socialImage
    ? toAbsoluteAssetUrl(display.socialImage.url, siteUrl, sitePathPrefix)
    : undefined;
  return buildArticleJsonLd({
    headline: meta.title,
    description: meta.description,
    url: canonicalHref,
    datePublished: display.articlePublishedTime,
    dateModified: display.articleModifiedTime,
    imageUrl,
    authorName: siteName,
  });
}

async function renderPostWithTextPreview(
  c: Context<Env>,
  post: Post,
  autoOpen: TextPreviewAutoOpen,
) {
  const navDataPromise = getNavigationData(c);
  const display = await assemblePostPageDisplay(c, post, {
    isAuthenticated: true,
  });
  if (!display) {
    return c.notFound();
  }

  const navData = await navDataPromise;
  const meta = buildPostMeta(post, navData.siteName);
  const canonicalHref = buildPostCanonicalHref(
    display.postView,
    display.threadPostViews,
    c.var.appConfig.siteUrl,
  );

  // Use the attachment summary as the page title (for OG/link previews),
  // and pass the post title in the payload so the client can restore it
  // when the dialog closes.
  const pageTitle = autoOpen.attachmentTitle || meta.title;
  // Metadata only — the HTML content lives in the SSR dialog below.
  // JSON lives inside a <script>, so escape `<` / `>` to defuse any
  // attacker-controlled content that manages to land in post titles.
  const autoOpenMeta = JSON.stringify({
    shareHref: autoOpen.shareHref,
    postHref: autoOpen.postHref,
    postTitle: meta.title,
    mediaId: autoOpen.mediaId,
  })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");

  return renderPublicPage(c, {
    title: buildPageTitle(pageTitle, navData.siteName),
    description: meta.description,
    canonicalHref,
    socialImageUrl: display.socialImage?.url,
    socialImageAlt: display.socialImage?.alt,
    socialImageWidth: display.socialImage?.width,
    socialImageHeight: display.socialImage?.height,
    ogType: "article",
    articlePublishedTime: display.articlePublishedTime,
    articleModifiedTime: display.articleModifiedTime,
    jsonLd: buildPostJsonLd(c, display, meta, canonicalHref, navData.siteName),
    navData,
    content: (
      <>
        <PostPage
          post={display.postView}
          threadPosts={display.threadPostViews}
        />
        {/* SSR dialog — visible immediately before JS loads. The
            text-preview-dialog--ssr modifier provides a CSS-based backdrop
            and scroll lock since ::backdrop only works with showModal().
            The Lit component adopts content and removes this on hydration. */}
        <dialog class="text-preview-dialog text-preview-dialog--ssr" open>
          <div class="text-preview-content">
            <div class="text-preview-toolbar">
              <div class="text-preview-btn" aria-hidden="true">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </div>
              <div class="text-preview-toolbar-actions" />
            </div>
            <div
              class="text-preview-body prose"
              dangerouslySetInnerHTML={{ __html: autoOpen.html }}
            />
          </div>
        </dialog>
        <script
          type="application/json"
          id="text-preview-autoopen"
          dangerouslySetInnerHTML={{ __html: autoOpenMeta }}
        />
      </>
    ),
  });
}

function canRenderDraftAboutEditor(
  c: Context<Env>,
  fullPath: string,
  post: Post,
): boolean {
  return (
    post.status === "draft" &&
    fullPath === ABOUT_PAGE_SLUG &&
    c.req.query("edit") === "1" &&
    c.var.isAuthenticated
  );
}

async function renderPost(
  c: Context<Env>,
  post: Post,
  options: { allowDraft?: boolean; isPreview?: boolean } = {},
) {
  // Start navData fetch immediately — it's independent of thread/media queries
  const navDataPromise = getNavigationData(c);
  const display = await assemblePostPageDisplay(c, post, {
    // Private-post access is validated before renderPost() is called.
    isAuthenticated: true,
    allowDraft: options.allowDraft,
    includeDraftThread: options.isPreview,
  });
  if (!display) {
    return c.notFound();
  }

  const navData = await navDataPromise;
  const meta = buildPostMeta(post, navData.siteName);
  const postView =
    options.isPreview && display.postView.status === "draft"
      ? {
          ...display.postView,
          permalink: toPublicPath(
            `/preview/${display.postView.slug}`,
            c.var.appConfig.sitePathPrefix,
          ),
        }
      : display.postView;
  const threadPostViews = options.isPreview
    ? display.threadPostViews?.map((threadPost) =>
        threadPost.status === "draft"
          ? {
              ...threadPost,
              permalink: toPublicPath(
                `/preview/${threadPost.slug}`,
                c.var.appConfig.sitePathPrefix,
              ),
            }
          : threadPost,
      )
    : display.threadPostViews;
  const previewTitle = options.isPreview
    ? getI18n(c)._(
        msg({
          message: "Draft preview",
          comment: "@context: Browser title prefix for a draft preview page",
        }),
      )
    : null;
  const canonicalHref = buildPostCanonicalHref(
    display.postView,
    display.threadPostViews,
    c.var.appConfig.siteUrl,
  );
  const draftEditHref = `${toPublicPath(
    `/preview/${post.slug}`,
    c.var.appConfig.sitePathPrefix,
  )}?edit=1`;

  return renderPublicPage(c, {
    title: previewTitle
      ? buildPageTitle(previewTitle, meta.title, navData.siteName)
      : buildPageTitle(meta.title, navData.siteName),
    description: meta.description,
    ...(post.status === "published"
      ? {
          canonicalHref,
          socialImageUrl: display.socialImage?.url,
          socialImageAlt: display.socialImage?.alt,
          socialImageWidth: display.socialImage?.width,
          socialImageHeight: display.socialImage?.height,
          ogType: "article" as const,
          articlePublishedTime: display.articlePublishedTime,
          articleModifiedTime: display.articleModifiedTime,
          jsonLd: buildPostJsonLd(
            c,
            display,
            meta,
            canonicalHref,
            navData.siteName,
          ),
        }
      : {}),
    navData,
    ...(options.isPreview
      ? {
          pageChrome: <DraftPreviewBar editHref={draftEditHref} />,
          noindex: true,
        }
      : {}),
    content: (
      <PostPage
        post={postView}
        threadPosts={threadPostViews}
        isPreview={options.isPreview}
      />
    ),
  });
}

pageRoutes.get("/preview/:slug", requireAuth(), async (c) => {
  const post = await c.var.services.posts.getBySlug(c.req.param("slug"));
  if (!post) return c.notFound();

  if (post.status === "published") {
    return c.redirect(
      toPublicPath(`/${post.slug}`, c.var.appConfig.sitePathPrefix),
    );
  }

  c.header("Cache-Control", "private, no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  return renderPost(c, post, { allowDraft: true, isPreview: true });
});

// Catch-all for path-registry backed post URLs, aliases, and redirects
pageRoutes.get("/*", async (c) => {
  const fullPath = c.req.path.slice(1); // Remove leading /
  if (!fullPath) return c.notFound();
  const sitePathPrefix = c.var.appConfig.sitePathPrefix;

  // Explicit application routes are registered before this catch-all. Any
  // unmatched path under a reserved prefix is therefore an application 404,
  // never a legacy alias or redirect from path_registry.
  if (isReservedPath(fullPath)) return c.notFound();

  // Stored redirects outrank the normal post/collection/deep-link resolvers,
  // but can never shadow an explicit or reserved application route.
  const resolved = await c.var.services.paths.resolve(fullPath);
  if (resolved?.kind === "redirect" && resolved.redirectToPath) {
    return c.redirect(
      toPublicHref(`/${resolved.redirectToPath}`, sitePathPrefix),
      resolved.redirectType ?? 301,
    );
  }

  if (fullPath.endsWith("/feed")) {
    const collectionPath = fullPath.slice(0, -"/feed".length);
    if (!collectionPath) return c.notFound();

    const resolvedCollection =
      await c.var.services.paths.resolve(collectionPath);
    if (resolvedCollection?.collectionId) {
      const collection = await c.var.services.collections.getById(
        resolvedCollection.collectionId,
      );
      if (!collection) return c.notFound();

      if (resolvedCollection.kind === "slug") {
        const alias = await c.var.services.customUrls.getByTarget(
          "collection",
          collection.id,
        );
        if (alias) {
          return c.redirect(
            toPublicPath(`/${alias.path}/feed`, sitePathPrefix),
            301,
          );
        }

        const result = await renderCollectionFeed(c, collection.slug);
        return result ?? c.notFound();
      }

      if (resolvedCollection.kind === "alias") {
        const result = await renderCollectionFeed(
          c,
          collection.slug,
          `/${resolvedCollection.path}/feed`,
        );
        return result ?? c.notFound();
      }
    }
  }

  // Text attachment deep-link: /{post-slug}/text/{media-id}
  const textMatch = fullPath.match(/^(.+)\/text\/([a-zA-Z0-9_-]+)$/);
  if (textMatch) {
    const slugPart = textMatch[1] ?? "";
    const mediaId = textMatch[2] ?? "";
    if (!slugPart || !mediaId) return c.notFound();
    const resolvedPost = await c.var.services.paths.resolve(slugPart);

    if (resolvedPost?.postId) {
      const post = await c.var.services.posts.getById(resolvedPost.postId);
      if (!post || post.status === "draft") return c.notFound();

      if (post.visibility === "private") {
        const navData = await getNavigationData(c);
        if (!navData.isAuthenticated) return c.notFound();
      }

      // Redirect slug → alias if one exists (same pattern as post pages)
      if (resolvedPost.kind === "slug") {
        const alias = await c.var.services.customUrls.getByTarget(
          "post",
          post.id,
        );
        if (alias) {
          return c.redirect(
            toPublicPath(`/${alias.path}/text/${mediaId}`, sitePathPrefix),
            301,
          );
        }
      }

      // Verify the media belongs to this post and is a Jant-composed text
      // attachment. Plain text-file uploads (.md, .txt, .csv) also carry
      // mediaKind === "text" but lack the split HTML/JSON sibling layout
      // that this page route expects — `isTextAttachment` excludes them.
      const media = await c.var.services.media.getById(mediaId);
      if (!media || media.postId !== post.id || !isTextAttachment(media)) {
        return c.notFound();
      }

      const attachment = await c.var.services.media.getTextAttachmentHtml(
        media.id,
        c.var.storage ?? null,
      );
      if (!attachment) return c.notFound();

      const postPermalink = toPublicPath(
        resolvedPost.path ? `/${resolvedPost.path}` : `/${post.slug}`,
        sitePathPrefix,
      );

      // Render the parent post page with auto-open data for the text preview dialog
      return renderPostWithTextPreview(c, post, {
        html: attachment.html,
        shareHref: c.req.path,
        postHref: postPermalink,
        attachmentTitle: attachment.summary ?? "",
        mediaId: media.id,
      });
    }
  }

  if (!resolved) return c.notFound();

  if (resolved.kind === "archive" && resolved.archiveQuery) {
    const overrides = Object.fromEntries(
      new URLSearchParams(resolved.archiveQuery),
    );
    return renderArchivePage(c, overrides);
  }

  if (resolved.postId) {
    const post = await c.var.services.posts.getById(resolved.postId);
    if (!post) return c.notFound();

    const allowDraft = canRenderDraftAboutEditor(c, fullPath, post);
    if (post.status === "draft" && !allowDraft) return c.notFound();

    if (post.visibility === "private") {
      const navData = await getNavigationData(c);
      if (!navData.isAuthenticated) return c.notFound();
    }

    // If accessed via slug but an alias exists, redirect to the alias
    if (resolved.kind === "slug") {
      const alias = await c.var.services.customUrls.getByTarget(
        "post",
        post.id,
      );
      if (alias) {
        return c.redirect(toPublicPath(`/${alias.path}`, sitePathPrefix), 301);
      }
    }

    return renderPost(c, post, { allowDraft });
  }

  if (resolved.collectionId) {
    const collection = await c.var.services.collections.getById(
      resolved.collectionId,
    );
    if (!collection) return c.notFound();

    if (resolved.kind === "slug") {
      const alias = await c.var.services.customUrls.getByTarget(
        "collection",
        collection.id,
      );
      if (alias) {
        return c.redirect(toPublicPath(`/${alias.path}`, sitePathPrefix), 301);
      }

      const result = await renderCollectionPage(c, collection.slug);
      return result ?? c.notFound();
    }

    if (resolved.kind === "alias") {
      const aliasPagePath = `/${resolved.path}`;
      const result = await renderCollectionPage(
        c,
        collection.slug,
        aliasPagePath,
      );
      return result ?? c.notFound();
    }
  }

  return c.notFound();
});
