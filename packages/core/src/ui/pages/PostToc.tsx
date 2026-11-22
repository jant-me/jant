import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { PostTocEntry } from "../../lib/post-toc.js";

export const PostToc: FC<{ entries: PostTocEntry[] }> = ({ entries }) => {
  const { i18n } = useLingui();
  const label = i18n._(
    msg({
      message: "Contents",
      comment: "@context: Table of contents navigation label on a post page",
    }),
  );

  return (
    <nav
      class="post-toc"
      data-post-toc
      {...(entries.length > 16 ? { "data-dense": "" } : {})}
      aria-label={label}
    >
      <button
        type="button"
        class="post-toc-trigger"
        aria-expanded="false"
        aria-controls="post-toc-sections"
        aria-label={label}
        data-post-toc-trigger
      >
        <span class="post-toc-ticks" aria-hidden="true">
          {entries.map(({ id, depth }) => (
            <span
              key={id}
              class="post-toc-tick"
              data-depth={String(depth)}
              data-post-toc-tick={id}
            />
          ))}
        </span>
        <svg
          class="post-toc-fab-icon"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M3 4.5h12M3 9h9.5M3 13.5h7" />
        </svg>
      </button>
      <div class="post-toc-panel" id="post-toc-sections" data-post-toc-panel>
        <p class="post-toc-title" aria-hidden="true">
          {label}
        </p>
        <ol class="post-toc-list">
          {entries.map(({ id, label: entryLabel, depth }) => (
            <li key={id} class="post-toc-item" data-depth={String(depth)}>
              <a href={`#${encodeURIComponent(id)}`} data-post-toc-link={id}>
                {entryLabel}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
};
