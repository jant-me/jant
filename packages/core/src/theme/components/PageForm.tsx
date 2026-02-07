/**
 * Page Creation/Edit Form
 *
 * For managing custom pages (posts with type="page")
 */

import type { FC } from "hono/jsx";
import type { Post } from "../../types.js";
import { useLingui } from "../../i18n/index.js";

export interface PageFormProps {
  page?: Post;
  action: string;
  cancelUrl?: string;
}

export const PageForm: FC<PageFormProps> = ({
  page,
  action,
  cancelUrl = "/dash/pages",
}) => {
  const { t } = useLingui();
  const isEdit = !!page;

  const signals = JSON.stringify({
    title: page?.title ?? "",
    path: page?.path ?? "",
    content: page?.content ?? "",
    visibility: page?.visibility ?? "unlisted",
  }).replace(/</g, "\\u003c");

  return (
    <form
      data-signals={signals}
      data-on:submit__prevent={`@post('${action}')`}
      class="flex flex-col gap-4"
    >
      <div id="page-form-message"></div>

      {/* Title */}
      <div class="field">
        <label class="label">
          {t({
            message: "Title",
            comment: "@context: Page form field label - title",
          })}
        </label>
        <input
          type="text"
          data-bind="title"
          class="input"
          placeholder={t({
            message: "Page title...",
            comment: "@context: Page title placeholder",
          })}
          required
        />
      </div>

      {/* Path */}
      <div class="field">
        <label class="label">
          {t({
            message: "Path",
            comment: "@context: Page form field label - URL path",
          })}
        </label>
        <div class="flex items-center gap-2">
          <span class="text-muted-foreground">/</span>
          <input
            type="text"
            data-bind="path"
            class="input flex-1"
            placeholder="about"
            pattern="[a-z0-9\-]+"
            title={t({
              message: "Lowercase letters, numbers, and hyphens only",
              comment: "@context: Page path validation message",
            })}
            required
          />
        </div>
        <p class="text-xs text-muted-foreground mt-1">
          {t({
            message:
              "The URL path for this page. Use lowercase letters, numbers, and hyphens.",
            comment: "@context: Page path helper text",
          })}
        </p>
      </div>

      {/* Content */}
      <div class="field">
        <label class="label">
          {t({
            message: "Content",
            comment: "@context: Page form field label - content",
          })}
        </label>
        <textarea
          data-bind="content"
          class="textarea min-h-48"
          placeholder={t({
            message: "Page content (Markdown supported)...",
            comment: "@context: Page content placeholder",
          })}
          required
        >
          {page?.content ?? ""}
        </textarea>
      </div>

      {/* Visibility */}
      <div class="field">
        <label class="label">
          {t({
            message: "Status",
            comment: "@context: Page form field label - publish status",
          })}
        </label>
        <select data-bind="visibility" class="select">
          <option
            value="unlisted"
            selected={page?.visibility === "unlisted" || !page}
          >
            {t({
              message: "Published",
              comment: "@context: Page status option - published",
            })}
          </option>
          <option value="draft" selected={page?.visibility === "draft"}>
            {t({
              message: "Draft",
              comment: "@context: Page status option - draft",
            })}
          </option>
        </select>
        <p class="text-xs text-muted-foreground mt-1">
          {t({
            message:
              "Published pages are accessible via their path. Drafts are not visible.",
            comment: "@context: Page status helper text",
          })}
        </p>
      </div>

      {/* Submit */}
      <div class="flex gap-2">
        <button type="submit" class="btn">
          {isEdit
            ? t({
                message: "Update Page",
                comment: "@context: Button to update existing page",
              })
            : t({
                message: "Create Page",
                comment: "@context: Button to create new page",
              })}
        </button>
        <a href={cancelUrl} class="btn-outline">
          {t({
            message: "Cancel",
            comment: "@context: Button to cancel and go back",
          })}
        </a>
      </div>
    </form>
  );
};
