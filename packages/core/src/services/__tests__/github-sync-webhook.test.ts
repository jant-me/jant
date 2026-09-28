/**
 * A push to the synced repository edits the matching post. A quote keeps its
 * source's name and URL in `title` and `url`, so the webhook has to put
 * `source_name` and `source_url` there; it used to pass them under names the
 * post service ignores, and edits to a quote's source never reached Jant.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../__tests__/helpers/app.js";
import { makeSiteConfig } from "../../__tests__/helpers/export-fixtures.js";
import { DEFAULT_TEST_SITE_ID } from "../../__tests__/helpers/db.js";
import { createGitHubSyncService } from "../github-sync.js";

function toBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub Sync webhook", () => {
  it("puts a quote's edited source name and URL where a quote keeps them", async () => {
    const { services } = createTestApp();
    const quote = await services.posts.create({
      format: "quote",
      quoteText: "Less is more.",
      title: "Old Source",
      url: "https://old.example/",
      status: "published",
    });
    await services.settings.set("GITHUB_SYNC_ENABLED", "true");
    await services.settings.set("GITHUB_SYNC_REPO", "owner/site");
    await services.settings.set("GITHUB_SYNC_TOKEN", "token");

    const file = [
      "---",
      `slug: ${quote.slug}`,
      "format: quote",
      "source_name: New Source",
      "source_url: https://new.example/",
      "quote_text: Less is more.",
      "---",
      "",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          sha: "abc",
          content: toBase64(file),
          encoding: "base64",
        }),
      ),
    );

    const sync = createGitHubSyncService(
      services,
      DEFAULT_TEST_SITE_ID,
      makeSiteConfig(),
    );
    await sync.handleWebhookPush({
      after: "head",
      commits: [
        {
          message: "Edit the quote's source",
          added: [],
          modified: [`content/${quote.slug}/_index.md`],
          removed: [],
        },
      ],
    } as Parameters<typeof sync.handleWebhookPush>[0]);

    const updated = await services.posts.getById(quote.id);
    expect(updated?.title).toBe("New Source");
    expect(updated?.url).toBe("https://new.example/");
  });
});
