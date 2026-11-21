import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { PostTocEntry } from "../../lib/post-toc.js";

export const PostToc: FC<{ entries: PostTocEntry[] }> = ({ entries }) => {
  const { i18n } = useLingui();
  const label = i18n._(
    msg({
      message: "Contents",
      comment: "@context: Table of contents in a post",
    }),
  );

  return (
    <nav class="post-toc" data-post-toc aria-label={label}>
      <button
        type="button"
        class="btn-outline post-toc-trigger"
        aria-expanded="false"
        aria-controls="post-toc-sections"
        data-post-toc-trigger
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M3 4h10M3 8h10M6 12h7" />
        </svg>
        {label}
      </button>
      <div class="post-toc-panel" id="post-toc-sections">
        <p class="post-toc-title" aria-hidden="true">
          {label}
        </p>
        <ol class="post-toc-list">
          {entries.map(({ id, label, level }) => (
            <li
              key={id}
              class={level === 3 ? "post-toc-subsection" : undefined}
            >
              <a href={`#${encodeURIComponent(id)}`} data-post-toc-link={id}>
                {label}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
};
