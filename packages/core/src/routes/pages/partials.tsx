import { Hono } from "hono";
import { I18nProvider } from "../../i18n/index.js";
import { parseIdParam } from "../../lib/errors.js";
import { ID_PREFIX } from "../../lib/ids.js";
import {
  assemblePostCardView,
  assemblePostPageDisplay,
} from "../../lib/post-display.js";
import { assembleTimelineItem } from "../../lib/timeline.js";
import { TimelineFeedItemContent } from "../../ui/feed/TimelineFeed.js";
import { TimelineItemFromPost } from "../../ui/feed/TimelineItem.js";
import { PostPage } from "../../ui/pages/PostPage.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { CORE_VERSION } from "../../lib/version.js";
import { matchesIfNoneMatch } from "../../lib/http-cache.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const partialPageRoutes = new Hono<Env>();

partialPageRoutes.get("/_/version", (c) => {
  return c.json({ version: CORE_VERSION });
});

/**
 * A text file attached to a post, for the preview dialog: its HTML, safe to
 * insert, and its source, for copying. The attachment's own page,
 * `/{post}/text/{id}`, applies the same rule of who may read it.
 */
partialPageRoutes.get("/_/text/:mediaId", async (c) => {
  const mediaId = parseIdParam(c.req.param("mediaId"), ID_PREFIX.media);
  const attachment = await c.var.services.textAttachments.readForViewer(
    mediaId,
    { isAuthenticated: c.var.isAuthenticated },
    c.var.storage,
  );
  if (!attachment) return c.notFound();

  // A shared cache may keep a public post's file, revalidating each time; a
  // private post's stays with the author's browser.
  const etag = `"${attachment.media.updatedAt}"`;
  const cacheControl =
    attachment.post.visibility === "private"
      ? "private, no-cache"
      : "public, no-cache";
  if (matchesIfNoneMatch(c.req.header("If-None-Match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }
  return c.json({ html: attachment.html, source: attachment.source }, 200, {
    ETag: etag,
    "Cache-Control": cacheControl,
  });
});

partialPageRoutes.get("/_/timeline-item/:threadRootId", async (c) => {
  const threadRootId = parseIdParam(
    c.req.param("threadRootId"),
    ID_PREFIX.post,
  );
  const item = await assembleTimelineItem(c, threadRootId, {
    isAuthenticated: c.var.isAuthenticated,
  });

  if (!item) {
    return c.notFound();
  }

  return c.html(
    <I18nProvider c={c}>
      <TimelineFeedItemContent item={item} />
    </I18nProvider>,
  );
});

partialPageRoutes.get("/_/post-card/:postId", async (c) => {
  const postId = parseIdParam(c.req.param("postId"), ID_PREFIX.post);
  const postView = await assemblePostCardView(c, postId, {
    isAuthenticated: c.var.isAuthenticated,
  });

  if (!postView) {
    return c.notFound();
  }

  return c.html(
    <I18nProvider c={c}>
      <TimelineItemFromPost post={postView} />
    </I18nProvider>,
  );
});

/**
 * A Post rendered as its detail page, with every control taken off.
 *
 * For surfaces that show one Post inside another context — the composer
 * writing a translation of it, so far. Those need the Post to *look* like
 * itself, because its structure is part of what the author is working from,
 * but they must not offer to act on it: the actions belong to the Post being
 * written, not to the one being read.
 *
 * Not a variant of `/_/post-view`: that one renders the whole Thread and is
 * what a page swaps itself for. This renders the root alone.
 */
partialPageRoutes.get("/_/post-preview/:postId", async (c) => {
  const postId = parseIdParam(c.req.param("postId"), ID_PREFIX.post);
  const postView = await assemblePostCardView(c, postId, {
    isAuthenticated: c.var.isAuthenticated,
  });

  if (!postView) {
    return c.notFound();
  }

  return c.html(
    <I18nProvider c={c}>
      <TimelineItemFromPost
        post={postView}
        mode="detail"
        display={{
          hideStatusBadges: true,
          showFullBody: true,
          // `hideTimestamp` is deliberately absent: a titled detail post puts
          // its date in the header, and the card only drops the footer's copy
          // when this is left undefined. Stating it either way prints the date
          // twice.
          footer: { hideActions: true, hideReply: true },
        }}
      />
    </I18nProvider>,
  );
});

partialPageRoutes.get("/_/post-view/:postId", async (c) => {
  const postId = parseIdParam(c.req.param("postId"), ID_PREFIX.post);
  const display = await assemblePostPageDisplay(c, postId, {
    isAuthenticated: c.var.isAuthenticated,
  });

  if (!display) {
    return c.notFound();
  }

  return c.html(
    <I18nProvider c={c}>
      <PostPage post={display.postView} threadPosts={display.threadPostViews} />
    </I18nProvider>,
  );
});
