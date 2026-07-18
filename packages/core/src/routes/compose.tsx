/**
 * Compose Route
 *
 * Handles post creation from the public-site compose dialog.
 * On publish the client reloads the page to pick up the new post.
 * Drafts close the dialog and show a confirmation toast.
 */

import { Hono } from "hono";
import { msg } from "@lingui/core/macro";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { requireAuth } from "../middleware/auth.js";
import { CreatePostApiSchema, CreateThreadApiSchema } from "../lib/schemas.js";
import { sse, dsToast } from "../lib/sse.js";
import { getI18n } from "../i18n/index.js";
import { toPublicPath } from "../lib/url.js";
import { triggerGitHubSyncInline } from "../lib/github-sync-trigger.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const composeRoutes = new Hono<Env>();

// All compose routes require authentication
composeRoutes.use("*", requireAuth());

/** Reset compose form signals to initial values */
const INITIAL_SIGNALS = {
  format: "note",
  title: "",
  body: "",
  url: "",
  quoteText: "",
  status: "published",
  rating: 0,
  collectionIds: [],
  _composeLoading: false,
  _showRating: false,
  _showCollection: false,
};

/** Script fragment that closes the compose dialog and self-removes */
const CLOSE_DIALOG_SCRIPT =
  "<div data-init=\"document.getElementById('compose-dialog').close(); el.remove()\"></div>";

composeRoutes.post("/", async (c) => {
  const i18n = getI18n(c);
  const raw = await c.req.json();
  const wantsJson = c.req.header("accept")?.includes("application/json");

  const result = CreatePostApiSchema.safeParse(raw);
  if (!result.success) {
    const firstError =
      result.error.issues[0]?.message ??
      i18n._(
        msg({
          message:
            "Something doesn't look right. Check the form and try again.",
          comment: "@context: Fallback validation error for compose form",
        }),
      );
    if (wantsJson) {
      return c.json({ status: "error" as const, error: firstError }, 422);
    }
    return dsToast(firstError, "error");
  }

  const data = result.data;

  const post = await c.var.services.posts.createWithAttachments(
    {
      format: data.format,
      slug: data.slug || undefined,
      title:
        data.format === "quote"
          ? data.sourceName || undefined
          : data.title || undefined,
      body: data.body || undefined,
      bodyMarkdown: data.bodyMarkdown || undefined,
      status: data.status ?? "published",
      visibility: data.visibility || undefined,
      featured: data.featured,
      url:
        data.format === "quote"
          ? data.sourceUrl || undefined
          : data.url || undefined,
      quoteText: data.quoteText || undefined,
      rating: data.rating || undefined,
      collectionIds: data.collectionIds,
      replyToId: data.replyToId,
      quietReply: data.quietReply,
      publishedAt: data.publishedAt,
    },
    data.attachments,
    {
      media: c.var.services.media,
      storage: c.var.storage,
      storageDriver: c.var.appConfig.storageDriver,
      maxFileSizeMB: c.var.appConfig.uploadMaxFileSize,
    },
    {
      maxParagraphs: c.var.appConfig.summaryMaxParagraphs,
      maxChars: c.var.appConfig.summaryMaxChars,
    },
  );

  const isDraft = (data.status ?? "published") === "draft";

  // Trigger GitHub Sync in background (no-op when sync isn't enabled).
  await triggerGitHubSyncInline(c);

  // ── JSON response mode (used by Lit compose bridge) ──────────────
  if (wantsJson) {
    if (isDraft) {
      return c.json({
        status: "draft" as const,
        toast: i18n._(
          msg({
            message: "Draft saved.",
            comment: "@context: Toast after saving a draft post",
          }),
        ),
      });
    }

    return c.json({
      status: "published" as const,
      permalink: toPublicPath(`/${post.slug}`, c.var.appConfig.sitePathPrefix),
    });
  }

  // ── SSE response mode (used by Datastar) ─────────────────────────
  if (isDraft) {
    return sse(c, async (stream) => {
      await stream.patchElements(CLOSE_DIALOG_SCRIPT, {
        mode: "append",
        selector: "body",
      });
      await stream.patchSignals(INITIAL_SIGNALS);
      await stream.toast(
        i18n._(
          msg({
            message: "Draft saved.",
            comment: "@context: Toast after saving a draft post",
          }),
        ),
      );
    });
  }

  return sse(c, async (stream) => {
    await stream.patchElements(CLOSE_DIALOG_SCRIPT, {
      mode: "append",
      selector: "body",
    });
    await stream.patchSignals(INITIAL_SIGNALS);
  });
});

composeRoutes.post("/thread", async (c) => {
  const i18n = getI18n(c);
  const raw = await c.req.json();

  const result = CreateThreadApiSchema.safeParse(raw);
  if (!result.success) {
    const firstError =
      result.error.issues[0]?.message ??
      i18n._(
        msg({
          message:
            "Something doesn't look right. Check the form and try again.",
          comment:
            "@context: Fallback validation error for thread compose form",
        }),
      );
    return c.json({ status: "error" as const, error: firstError }, 422);
  }

  const { posts: postSchemas, replaceThreadId } = result.data;
  const storageOpts = {
    media: c.var.services.media,
    storage: c.var.storage,
    storageDriver: c.var.appConfig.storageDriver,
    maxFileSizeMB: c.var.appConfig.uploadMaxFileSize,
  };
  const summaryConfig = {
    maxParagraphs: c.var.appConfig.summaryMaxParagraphs,
    maxChars: c.var.appConfig.summaryMaxChars,
  };

  const firstSchema = postSchemas[0];
  if (!firstSchema) {
    return c.json(
      { status: "error" as const, error: "No posts provided" },
      422,
    );
  }
  const status = firstSchema.status ?? "published";
  const isDraft = status === "draft";

  // When re-editing a thread draft, delete the old thread first to free up
  // paths (slugs) and avoid conflicts.
  if (replaceThreadId) {
    await c.var.services.posts.deleteThreadDraft(replaceThreadId, {
      media: c.var.services.media,
      storage: c.var.storage,
    });
  }

  const threadPosts = await c.var.services.posts.createThreadWithAttachments(
    postSchemas.map((data, index) => ({
      data: {
        format: data.format,
        slug: index === 0 ? data.slug || undefined : undefined,
        title:
          data.format === "quote"
            ? data.sourceName || undefined
            : data.title || undefined,
        body: data.body || undefined,
        bodyMarkdown: data.bodyMarkdown || undefined,
        status,
        visibility: index === 0 ? data.visibility || undefined : undefined,
        url:
          data.format === "quote"
            ? data.sourceUrl || undefined
            : data.url || undefined,
        quoteText: data.quoteText || undefined,
        rating: data.rating || undefined,
        collectionIds: index === 0 ? data.collectionIds : undefined,
        replyToId: index === 0 ? data.replyToId : undefined,
        publishedAt: index === 0 ? data.publishedAt : undefined,
      },
      attachments: data.attachments,
    })),
    storageOpts,
    summaryConfig,
  );

  const root = threadPosts[0];
  if (!root) {
    return c.json(
      { status: "error" as const, error: "Thread creation failed" },
      500,
    );
  }

  // Trigger GitHub Sync in background (no-op when sync isn't enabled).
  await triggerGitHubSyncInline(c);

  if (isDraft) {
    return c.json({
      status: "draft" as const,
      toast: i18n._(
        msg({
          message: "Draft saved.",
          comment: "@context: Toast after saving a draft post",
        }),
      ),
    });
  }

  return c.json({
    status: "published" as const,
    permalink: toPublicPath(`/${root.slug}`, c.var.appConfig.sitePathPrefix),
  });
});
