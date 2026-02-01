/**
 * Page Creation/Edit Form
 *
 * For managing custom pages (posts with type="page")
 */

import type { FC } from "hono/jsx";
import type { Post } from "../../types.js";
import type { Context } from "hono";
import { msg } from "@lingui/core/macro";
import { getI18n } from "../../i18n/index.js";

export interface PageFormProps {
  c: Context;
  page?: Post;
  action: string;
  cancelUrl?: string;
}

export const PageForm: FC<PageFormProps> = ({
  c,
  page,
  action,
  cancelUrl = "/dash/pages",
}) => {
  const i18n = getI18n(c);
  const isEdit = !!page;

  return (
    <form method="post" action={action} class="flex flex-col gap-4">
      {/* Hidden type field */}
      <input type="hidden" name="type" value="page" />

      {/* Title */}
      <div class="field">
        <label class="label">
          {i18n._(msg({ message: "Title", comment: "@context: Page form field label - title" }))}
        </label>
        <input
          type="text"
          name="title"
          class="input"
          placeholder={i18n._(msg({ message: "Page title...", comment: "@context: Page title placeholder" }))}
          value={page?.title ?? ""}
          required
        />
      </div>

      {/* Path */}
      <div class="field">
        <label class="label">
          {i18n._(msg({ message: "Path", comment: "@context: Page form field label - URL path" }))}
        </label>
        <div class="flex items-center gap-2">
          <span class="text-muted-foreground">/</span>
          <input
            type="text"
            name="path"
            class="input flex-1"
            placeholder="about"
            value={page?.path ?? ""}
            pattern="[a-z0-9\-]+"
            title={i18n._(msg({ message: "Lowercase letters, numbers, and hyphens only", comment: "@context: Page path validation message" }))}
            required
          />
        </div>
        <p class="text-xs text-muted-foreground mt-1">
          {i18n._(msg({ message: "The URL path for this page. Use lowercase letters, numbers, and hyphens.", comment: "@context: Page path helper text" }))}
        </p>
      </div>

      {/* Content */}
      <div class="field">
        <label class="label">
          {i18n._(msg({ message: "Content", comment: "@context: Page form field label - content" }))}
        </label>
        <textarea
          name="content"
          class="textarea min-h-48"
          placeholder={i18n._(msg({ message: "Page content (Markdown supported)...", comment: "@context: Page content placeholder" }))}
          required
        >
          {page?.content ?? ""}
        </textarea>
      </div>

      {/* Visibility */}
      <div class="field">
        <label class="label">
          {i18n._(msg({ message: "Status", comment: "@context: Page form field label - publish status" }))}
        </label>
        <select name="visibility" class="select">
          <option value="unlisted" selected={page?.visibility === "unlisted" || !page}>
            {i18n._(msg({ message: "Published", comment: "@context: Page status option - published" }))}
          </option>
          <option value="draft" selected={page?.visibility === "draft"}>
            {i18n._(msg({ message: "Draft", comment: "@context: Page status option - draft" }))}
          </option>
        </select>
        <p class="text-xs text-muted-foreground mt-1">
          {i18n._(msg({ message: "Published pages are accessible via their path. Drafts are not visible.", comment: "@context: Page status helper text" }))}
        </p>
      </div>

      {/* Submit */}
      <div class="flex gap-2">
        <button type="submit" class="btn">
          {isEdit
            ? i18n._(msg({ message: "Update Page", comment: "@context: Button to update existing page" }))
            : i18n._(msg({ message: "Create Page", comment: "@context: Button to create new page" }))}
        </button>
        <a href={cancelUrl} class="btn-outline">
          {i18n._(msg({ message: "Cancel", comment: "@context: Button to cancel and go back" }))}
        </a>
      </div>
    </form>
  );
};
