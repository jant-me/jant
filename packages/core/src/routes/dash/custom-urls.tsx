/**
 * Custom URLs Routes
 *
 * Mounted under /settings/custom-urls
 */

import { msg } from "@lingui/core/macro";
import { Hono } from "hono";
import { useLingui } from "../../i18n/context.js";
import type { Bindings, CustomUrl } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { EmptyState } from "../../ui/dash/index.js";
import { dsRedirect } from "../../lib/sse.js";
import { parseIdParam, NotFoundError } from "../../lib/errors.js";
import { ID_PREFIX } from "../../lib/ids.js";
import { CreateCustomUrlSchema, parseValidated } from "../../lib/schemas.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import { getNavigationData } from "../../lib/navigation.js";
import { AdminBreadcrumb } from "../../ui/shared/AdminBreadcrumb.js";
import { PagePagination } from "../../ui/shared/Pagination.js";
import { buildConfirmActionExpression } from "../../lib/confirm.js";
import { toPublicPath } from "../../lib/url.js";
import { buildCollectionVocabulary } from "../../lib/filter-dimensions.js";
import {
  parseArchiveUrlForUpgrade,
  type SmartCollectionUpgrade,
} from "../../lib/smart-collection-upgrade.js";
import {
  getSmartCollectionDialogLabels,
  getSmartCollectionLabels,
} from "../../ui/shared/smart-collection-labels.js";
import { getI18n } from "../../i18n/index.js";

const escapeJson = (data: unknown) =>
  JSON.stringify(data).replace(/</g, "\\u003c");

type Env = { Bindings: Bindings; Variables: AppVariables };

export const customUrlsRoutes = new Hono<Env>();

function TargetTypeIcon({
  targetType,
}: {
  targetType: CustomUrl["targetType"];
}) {
  switch (targetType) {
    case "post":
      return (
        <svg
          class="custom-url-type-icon"
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M14 3H7a2 2 0 0 0-2 2v14" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6" />
          <path d="M9 17h4" />
          <path d="M14 3l5 5v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-1" />
        </svg>
      );
    case "collection":
      return (
        <svg
          class="custom-url-type-icon"
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="4" width="11" height="11" rx="2" />
          <path d="M9 20h9a2 2 0 0 0 2-2V9" />
        </svg>
      );
    case "redirect":
      return (
        <svg
          class="custom-url-type-icon"
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M8 8h9v9" />
          <path d="m8 16 9-9" />
        </svg>
      );
    case "archive":
      return (
        <svg
          class="custom-url-type-icon"
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect width="20" height="5" x="2" y="3" rx="1" />
          <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
          <path d="M10 12h4" />
        </svg>
      );
  }
}

function targetPath(
  customUrl: CustomUrl,
  targetSlugs: Record<string, string>,
): string {
  if (customUrl.targetType === "redirect") {
    return customUrl.toPath ?? "?";
  }

  if (customUrl.targetType === "archive") {
    return `/archive?${customUrl.archiveQuery ?? ""}`;
  }

  return customUrl.targetId
    ? `/${targetSlugs[customUrl.targetId] ?? customUrl.targetId}`
    : "/?";
}

function CustomUrlsListContent({
  customUrls,
  targetSlugs,
  upgradableArchiveIds,
  currentPage,
  totalPages,
  sitePathPrefix = "",
}: {
  customUrls: CustomUrl[];
  targetSlugs: Record<string, string>;
  /** Stored archive paths whose query can become a smart collection exactly. */
  upgradableArchiveIds: Map<string, SmartCollectionUpgrade>;
  currentPage: number;
  totalPages: number;
  sitePathPrefix?: string;
}) {
  const { i18n } = useLingui();
  const smartLabels = getSmartCollectionLabels(i18n);
  const hasCustomUrls = customUrls.length > 0;
  const targetTypeLabels = {
    post: i18n._(
      msg({
        message: "Post",
        comment: "@context: Custom URL target type badge for a post",
      }),
    ),
    collection: i18n._(
      msg({
        message: "Collection",
        comment: "@context: Custom URL target type badge for a collection",
      }),
    ),
    redirect: i18n._(
      msg({
        message: "Redirect",
        comment: "@context: Custom URL target type badge for a redirect",
      }),
    ),
    archive: i18n._(
      msg({
        message: "Archive",
        comment: "@context: Custom URL target type badge for an archive view",
      }),
    ),
  } satisfies Record<CustomUrl["targetType"], string>;
  const moreActionsLabel = i18n._(
    msg({
      message: "More actions",
      comment: "@context: Button label for a menu with more actions",
    }),
  );
  const deleteLabel = i18n._(
    msg({
      message: "Delete",
      comment: "@context: Button to delete custom URL",
    }),
  );
  const cancelLabel = i18n._(
    msg({
      message: "Cancel",
      comment: "@context: Button label to dismiss a dialog or action",
    }),
  );

  return (
    <div class="max-w-2xl">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-medium">
          {i18n._(
            msg({
              message: "Custom URLs",
              comment: "@context: Settings section heading",
            }),
          )}
        </h2>
        {hasCustomUrls ? (
          <a
            href={toPublicPath("/settings/custom-urls/new", sitePathPrefix)}
            class="btn"
          >
            {i18n._(
              msg({
                message: "New Custom URL",
                comment: "@context: Button to create new custom URL",
              }),
            )}
          </a>
        ) : null}
      </div>

      {!hasCustomUrls ? (
        <EmptyState
          message={i18n._(
            msg({
              message:
                "No custom URLs yet. Create one to add redirects or custom paths for posts.",
              comment: "@context: Empty state message",
            }),
          )}
          ctaText={i18n._(
            msg({
              message: "New Custom URL",
              comment: "@context: Button to create new custom URL",
            }),
          )}
          ctaHref={toPublicPath("/settings/custom-urls/new", sitePathPrefix)}
        />
      ) : (
        <>
          <div class="settings-group">
            {customUrls.map((cu) => (
              <div key={cu.id} class="custom-url-row" data-custom-url-actions>
                <div class="custom-url-row-main">
                  <div class="custom-url-row-header">
                    <code class="custom-url-path">/{cu.path}</code>
                    <div class="custom-url-row-menu">
                      <button
                        type="button"
                        class="custom-url-menu-trigger"
                        aria-label={moreActionsLabel}
                        aria-controls={`custom-url-menu-${cu.id}`}
                        aria-expanded="false"
                        aria-haspopup="menu"
                        title={moreActionsLabel}
                        data-custom-url-action="toggle-menu"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <circle cx="5" cy="12" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="19" cy="12" r="2" />
                        </svg>
                      </button>
                      <div
                        id={`custom-url-menu-${cu.id}`}
                        class="custom-url-menu"
                        role="menu"
                        data-custom-url-menu
                        popover="manual"
                        hidden
                      >
                        {/* A stored archive path predates smart collections.
                            Offered only when its query can be honored exactly
                            — the same strict read a directory link gets, and
                            the same prefilled dialog, so the title is one the
                            author typed rather than a path turned into a
                            heading. */}
                        {cu.targetType === "archive" &&
                        upgradableArchiveIds.has(cu.id) ? (
                          <button
                            type="button"
                            class="custom-url-menu-item"
                            role="menuitem"
                            data-custom-url-action="upgrade"
                            data-custom-url-upgrade={escapeJson({
                              title: cu.path,
                              selection:
                                upgradableArchiveIds.get(cu.id)?.selection ??
                                {},
                              sort: upgradableArchiveIds.get(cu.id)?.sort,
                              layout: upgradableArchiveIds.get(cu.id)?.layout,
                            })}
                          >
                            {smartLabels.turnIntoSmartCollection}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          class="custom-url-menu-item custom-url-menu-item-danger"
                          role="menuitem"
                          data-custom-url-action="delete"
                          data-on:click__prevent={buildConfirmActionExpression(
                            `@post('${toPublicPath(
                              `/settings/custom-urls/${cu.id}/delete`,
                              sitePathPrefix,
                            )}')`,
                            {
                              message: i18n._(
                                msg({
                                  message:
                                    "Delete this custom URL? Visitors using it won't be redirected anymore.",
                                  comment:
                                    "@context: Confirm dialog for deleting a custom URL",
                                }),
                              ),
                              confirmLabel: deleteLabel,
                              cancelLabel,
                              tone: "danger",
                            },
                          )}
                        >
                          {deleteLabel}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div class="custom-url-row-flow">
                    <span class="custom-url-flow-arrow" aria-hidden="true">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M12 5v14" />
                        <path d="m19 12-7 7-7-7" />
                      </svg>
                    </span>
                    <div class="custom-url-row-target">
                      <code class="custom-url-target-path">
                        {targetPath(cu, targetSlugs)}
                      </code>
                      <span class="custom-url-target-meta">
                        <span class="custom-url-type-mark">
                          <TargetTypeIcon targetType={cu.targetType} />
                          <span>{targetTypeLabels[cu.targetType]}</span>
                        </span>
                        {cu.targetType === "redirect" && cu.redirectType ? (
                          <span class="custom-url-redirect-code">
                            {cu.redirectType}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <PagePagination
            baseUrl={toPublicPath("/settings/custom-urls", sitePathPrefix)}
            currentPage={currentPage}
            totalPages={totalPages}
          />
        </>
      )}
    </div>
  );
}

function NewCustomUrlContent({
  sitePathPrefix = "",
}: {
  sitePathPrefix?: string;
}) {
  const { i18n } = useLingui();

  return (
    <>
      <h2 class="text-lg font-medium mb-6">
        {i18n._(
          msg({
            message: "New Custom URL",
            comment: "@context: Page heading",
          }),
        )}
      </h2>

      <form
        data-signals="{path: '', targetType: 'redirect', targetId: '', toPath: '', redirectType: '301', archiveQuery: ''}"
        data-on:submit__prevent={`@post('${toPublicPath("/settings/custom-urls", sitePathPrefix)}')`}
        data-indicator="_loading"
        class="flex flex-col gap-4 max-w-2xl"
      >
        <div class="field">
          <label class="label">
            {i18n._(
              msg({
                message: "Path",
                comment: "@context: Custom URL form field",
              }),
            )}
          </label>
          <div class="flex items-center">
            <span class="flex items-center justify-center h-9 px-3 border border-r-0 border-input rounded-l-md bg-muted text-muted-foreground text-sm">
              /
            </span>
            <input
              type="text"
              data-bind="path"
              class="input rounded-l-none"
              placeholder="blog/my-post"
              required
            />
          </div>
        </div>

        <div class="field">
          <label class="label">
            {i18n._(
              msg({
                message: "Type",
                comment: "@context: Custom URL form field",
              }),
            )}
          </label>
          <select data-bind="targetType" class="select">
            <option value="redirect">
              {i18n._(
                msg({
                  message: "Redirect",
                  comment: "@context: Custom URL type option",
                }),
              )}
            </option>
            <option value="post">
              {i18n._(
                msg({
                  message: "Post",
                  comment: "@context: Custom URL type option",
                }),
              )}
            </option>
            <option value="collection">
              {i18n._(
                msg({
                  message: "Collection",
                  comment: "@context: Custom URL type option",
                }),
              )}
            </option>
          </select>
        </div>

        <div data-show="$targetType === 'redirect'" class="flex flex-col gap-4">
          <div class="field">
            <label class="label">
              {i18n._(
                msg({
                  message: "Destination",
                  comment: "@context: Redirect destination field",
                }),
              )}
            </label>
            <input
              type="text"
              data-bind="toPath"
              class="input"
              placeholder="/new-path or https://..."
            />
          </div>

          <div class="field">
            <label class="label">
              {i18n._(
                msg({
                  message: "Redirect Type",
                  comment: "@context: Redirect type field",
                }),
              )}
            </label>
            <select data-bind="redirectType" class="select">
              <option value="301">
                {i18n._(
                  msg({
                    message: "301 (Permanent)",
                    comment: "@context: Redirect type option",
                  }),
                )}
              </option>
              <option value="302">
                {i18n._(
                  msg({
                    message: "302 (Temporary)",
                    comment: "@context: Redirect type option",
                  }),
                )}
              </option>
            </select>
          </div>
        </div>

        <div
          data-show="$targetType === 'post' || $targetType === 'collection'"
          class="field"
        >
          <label class="label">
            {i18n._(
              msg({
                message: "Target Slug",
                comment: "@context: Custom URL target slug field",
              }),
            )}
          </label>
          <input
            type="text"
            data-bind="targetId"
            class="input"
            placeholder="my-post-slug"
          />
          <p class="text-xs text-muted-foreground mt-1">
            {i18n._(
              msg({
                message: "The slug of the target post or collection",
                comment: "@context: Custom URL target slug help text",
              }),
            )}
          </p>
        </div>

        <div class="flex gap-2">
          <button type="submit" class="btn" data-attr:disabled="$_loading">
            <svg
              data-show="$_loading"
              style="display:none"
              class="animate-spin size-4"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              role="status"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            {i18n._(
              msg({
                message: "Create Custom URL",
                comment: "@context: Button to save new custom URL",
              }),
            )}
          </button>
          <a
            href={toPublicPath("/settings/custom-urls", sitePathPrefix)}
            class="btn-outline"
          >
            {i18n._(
              msg({
                message: "Cancel",
                comment: "@context: Button to cancel form",
              }),
            )}
          </a>
        </div>
      </form>
    </>
  );
}

// List custom URLs
customUrlsRoutes.get("/", async (c) => {
  const pageParam = c.req.query("page");
  const currentPage = Math.max(1, parseInt(pageParam || "1", 10) || 1);
  const pageSize = c.var.appConfig.pageSize;

  const [total, customUrlsList] = await Promise.all([
    c.var.services.customUrls.count(),
    c.var.services.customUrls.list({
      limit: pageSize,
      offset: (currentPage - 1) * pageSize,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Resolve target TypeIDs → slugs for display
  const targetSlugs: Record<string, string> = {};
  for (const cu of customUrlsList) {
    if (!cu.targetId || cu.targetType === "redirect") continue;
    if (cu.targetType === "post") {
      const post = await c.var.services.posts.getById(cu.targetId);
      if (post) targetSlugs[cu.targetId] = post.slug;
    } else if (cu.targetType === "collection") {
      const col = await c.var.services.collections.getById(cu.targetId);
      if (col) targetSlugs[cu.targetId] = col.slug;
    }
  }

  // A stored archive path can only become a smart collection when its query is
  // fully understood, so the check runs where the collections are — resolving
  // `?collection=` needs them, and offering a button that would then refuse is
  // worse than not offering it.
  const upgradableArchiveIds = new Map<string, SmartCollectionUpgrade>();
  const archiveRows = customUrlsList.filter(
    (cu) => cu.targetType === "archive" && cu.archiveQuery,
  );
  if (archiveRows.length > 0) {
    const dimensionCtx = {
      collections: buildCollectionVocabulary(
        await c.var.services.collections.list(),
      ),
    };
    for (const cu of archiveRows) {
      const upgrade = parseArchiveUrlForUpgrade(
        `/archive?${cu.archiveQuery ?? ""}`,
        dimensionCtx,
      );
      if (upgrade) upgradableArchiveIds.set(cu.id, upgrade);
    }
  }

  const navData = await getNavigationData(c);

  return renderPublicPage(c, {
    title: buildPageTitle("Custom URLs", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent="Settings"
          parentHref={toPublicPath("/settings", c.var.appConfig.sitePathPrefix)}
          current="Custom URLs"
        />
        {/* The dialog is a Lit component and cannot reach the i18n catalogs,
            so the page that can open it carries its strings. */}
        <div
          hidden
          data-smart-collection-dialog-labels={escapeJson(
            getSmartCollectionDialogLabels(getI18n(c)),
          )}
        />
        <CustomUrlsListContent
          customUrls={customUrlsList}
          targetSlugs={targetSlugs}
          upgradableArchiveIds={upgradableArchiveIds}
          currentPage={currentPage}
          totalPages={totalPages}
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
        />
      </>
    ),
  });
});

// New custom URL form
customUrlsRoutes.get("/new", async (c) => {
  const navData = await getNavigationData(c);

  return renderPublicPage(c, {
    title: buildPageTitle("New Custom URL", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          ancestors={[
            {
              label: "Settings",
              href: toPublicPath("/settings", c.var.appConfig.sitePathPrefix),
            },
            {
              label: "Custom URLs",
              href: toPublicPath(
                "/settings/custom-urls",
                c.var.appConfig.sitePathPrefix,
              ),
            },
          ]}
          current="New Custom URL"
        />
        <NewCustomUrlContent sitePathPrefix={c.var.appConfig.sitePathPrefix} />
      </>
    ),
  });
});

// Create custom URL
customUrlsRoutes.post("/", async (c) => {
  const body = parseValidated(CreateCustomUrlSchema, await c.req.json());

  const redirectType = body.redirectType
    ? (parseInt(body.redirectType, 10) as 301 | 302)
    : undefined;

  // Resolve slug → ID for post/collection targets
  let targetId = body.targetId;
  if (body.targetType === "post" && body.targetId) {
    const post = await c.var.services.posts.getBySlug(body.targetId);
    if (!post) {
      throw new NotFoundError(`Post with slug "${body.targetId}"`);
    }
    targetId = post.id;
  }
  if (body.targetType === "collection" && body.targetId) {
    const col = await c.var.services.collections.getBySlug(body.targetId);
    if (!col) {
      throw new NotFoundError(`Collection with slug "${body.targetId}"`);
    }
    targetId = col.id;
  }

  await c.var.services.customUrls.create({
    path: body.path,
    targetType: body.targetType,
    targetId,
    toPath: body.toPath,
    redirectType,
  });

  return dsRedirect(
    toPublicPath("/settings/custom-urls", c.var.appConfig.sitePathPrefix),
  );
});

// Delete custom URL
customUrlsRoutes.post("/:id/delete", async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.path);
  await c.var.services.customUrls.delete(id);

  return dsRedirect(
    toPublicPath("/settings/custom-urls", c.var.appConfig.sitePathPrefix),
  );
});
