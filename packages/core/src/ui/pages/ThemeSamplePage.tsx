import { msg } from "@lingui/core/macro";
import { useLingui } from "../../i18n/context.js";
import { getCollectionPagePath } from "../../lib/collection-paths.js";
import { escapeHtml } from "../../lib/html.js";
import { toPublicPath } from "../../lib/url.js";
import type { PostView } from "../../types.js";
import type { ThemeMode } from "../../types/config.js";
import { TimelineItemFromPost } from "../feed/TimelineItem.js";
import { PostPage } from "./PostPage.js";
import type { ColorTheme } from "../color-themes.js";

const MODES: ThemeMode[] = ["auto", "light", "dark"];

function buildSampleHref(
  themeId: string,
  mode: ThemeMode,
  sitePathPrefix = "",
): string {
  const params = new URLSearchParams({
    theme: themeId,
    mode,
  });
  return toPublicPath(`/_/theme-sample?${params.toString()}`, sitePathPrefix);
}

function isActivePill(current: string, value: string): string {
  return current === value ? "btn" : "btn-outline";
}

function renderParagraph(text: string): string {
  return `<p>${escapeHtml(text)}</p>`;
}

function renderHeading(level: 2 | 3, text: string): string {
  return `<h${level}>${escapeHtml(text)}</h${level}>`;
}

function renderParagraphWithLink(
  before: string,
  href: string,
  label: string,
  after = "",
): string {
  return `<p>${escapeHtml(before)} <a href="${escapeHtml(href)}">${escapeHtml(label)}</a>${after ? ` ${escapeHtml(after)}` : ""}</p>`;
}

function renderList(tag: "ul" | "ol", items: string[]): string {
  return `<${tag}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
}

function renderBlockquote(text: string): string {
  return `<blockquote><p>${escapeHtml(text)}</p></blockquote>`;
}

function renderCodeBlock(code: string): string {
  return `<pre><code>${escapeHtml(code)}</code></pre>`;
}

function renderTable(headers: string[], rows: string[][]): string {
  const head = headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
    )
    .join("");

  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderFigure(src: string, alt: string, caption: string): string {
  return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="1200" height="760" loading="lazy" /><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

const SAMPLE_ARTICLE_IMAGE =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 760'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%23f4ecdf'/%3E%3Cstop offset='55%25' stop-color='%23c6d8e2'/%3E%3Cstop offset='100%25' stop-color='%23708b99'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='1200' height='760' fill='url(%23g)'/%3E%3Cpath d='M0 580 C220 470 360 700 620 610 C820 540 950 420 1200 500 L1200 760 L0 760 Z' fill='%23efe6d7' fill-opacity='0.82'/%3E%3Ccircle cx='270' cy='240' r='120' fill='%23fbf7ee' fill-opacity='0.65'/%3E%3Cpath d='M690 170h250v18H690zm0 58h180v18H690zm0 58h230v18H690z' fill='%232d4758' fill-opacity='0.82'/%3E%3Crect x='150' y='150' width='360' height='240' rx='26' fill='%23f7f2e7' fill-opacity='0.76' stroke='%23e8dcc8'/%3E%3Cpath d='M210 315l78-88 84 76 54-52 84 104H210z' fill='%2392b6c8' fill-opacity='0.92'/%3E%3Ccircle cx='300' cy='228' r='36' fill='%23f3c98b'/%3E%3C/svg%3E";

function TokenSwatch({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}) {
  return (
    <div class="rounded-xl border p-4">
      <div class="flex items-center gap-3">
        <span
          class="h-9 w-9 rounded-full border shrink-0"
          style={`background:${value ?? "transparent"}`}
        />
        <div class="min-w-0">
          <div class="text-sm font-medium">{label}</div>
          <code class="block text-[11px] leading-5 font-mono text-muted-foreground break-words">
            {value}
          </code>
        </div>
      </div>
    </div>
  );
}

function ModePalette({
  label,
  colors,
}: {
  label: string;
  colors: Record<string, string>;
}) {
  return (
    <section class="card p-6 md:p-7">
      <div class="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold">{label}</h2>
          <p class="text-sm text-muted-foreground">
            {colors["--background"]} background with live token values.
          </p>
        </div>
      </div>
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TokenSwatch label="Background" value={colors["--background"]} />
        <TokenSwatch label="Foreground" value={colors["--foreground"]} />
        <TokenSwatch label="Primary" value={colors["--primary"]} />
        <TokenSwatch label="Site accent" value={colors["--site-accent"]} />
        <TokenSwatch label="Muted" value={colors["--muted"]} />
        <TokenSwatch label="Border" value={colors["--border"]} />
      </div>
    </section>
  );
}

export function ThemeSamplePage({
  themes,
  selectedTheme,
  currentMode,
  sitePathPrefix = "",
}: {
  themes: Pick<ColorTheme, "id" | "name">[];
  selectedTheme: ColorTheme;
  currentMode: ThemeMode;
  sitePathPrefix?: string;
}) {
  const { i18n } = useLingui();
  const sampleBaseHref = buildSampleHref(
    selectedTheme.id,
    currentMode,
    sitePathPrefix,
  );
  const notePermalink = `${sampleBaseHref}#sample-note`;
  const linkPermalink = `${sampleBaseHref}#sample-link`;
  const quotePermalink = `${sampleBaseHref}#sample-quote`;
  const articlePermalink = `${sampleBaseHref}#sample-article-detail`;

  const samplePosts: [PostView, PostView, PostView] = [
    {
      id: "018e2b6f-3a10-7000-8000-000000000001",
      permalink: notePermalink,
      slug: "sample-note",
      title: i18n._(
        msg({
          message: "Why the default accent should feel written, not branded",
          comment: "@context: Sample note post title on the theme sample page",
        }),
      ),
      bodyHtml: [
        renderParagraphWithLink(
          i18n._(
            msg({
              message:
                "The default accent works best when it reads like a fountain-pen underline. Compare it against the",
              comment:
                "@context: Sample note post body prefix on the theme sample page",
            }),
          ),
          sampleBaseHref,
          i18n._(
            msg({
              message: "live theme controls",
              comment:
                "@context: Inline link label in the sample note post body",
            }),
          ),
          i18n._(
            msg({
              message:
                "before deciding whether the accent is carrying too much product energy.",
              comment:
                "@context: Sample note post body suffix on the theme sample page",
            }),
          ),
        ),
        renderParagraph(
          i18n._(
            msg({
              message:
                "Buttons can stay steady, but links, thread markers, and subtle emphasis should feel closer to ink on paper than dashboard chrome.",
              comment:
                "@context: Sample note post second paragraph on the theme sample page",
            }),
          ),
        ),
      ].join(""),
      summary: i18n._(
        msg({
          message:
            "A calmer, warmer accent makes the default theme feel quieter and more intentional.",
          comment: "@context: Plain-text summary for the sample note post",
        }),
      ),
      excerpt: i18n._(
        msg({
          message:
            "A calmer, warmer accent makes the default theme feel quieter and more intentional.",
          comment: "@context: Excerpt for the sample note post",
        }),
      ),
      summaryHtml: [
        renderParagraphWithLink(
          i18n._(
            msg({
              message:
                "The default accent should support reading first. Start by comparing it against the",
              comment:
                "@context: Sample note summary prefix on the theme sample page",
            }),
          ),
          sampleBaseHref,
          i18n._(
            msg({
              message: "live theme controls",
              comment: "@context: Inline link label in the sample note summary",
            }),
          ),
          i18n._(
            msg({
              message: "instead of judging it as an isolated swatch.",
              comment:
                "@context: Sample note summary suffix on the theme sample page",
            }),
          ),
        ),
        renderParagraph(
          i18n._(
            msg({
              message:
                "When the accent is slightly warmer and less literal, the whole page feels more like a writing space and less like product UI.",
              comment:
                "@context: Sample note summary second paragraph on the theme sample page",
            }),
          ),
        ),
      ].join(""),
      summaryHasMore: true,
      format: "note",
      status: "published",
      visibility: "public",
      pinned: false,
      featured: true,
      rating: 4,
      publishedAt: "2026-03-15T09:18:00Z",
      publishedAtFormatted: "Mar 15, 2026",
      publishedAtTime: "09:18",
      publishedAtRelative: "Mar 15",
      updatedAt: "2026-03-15T09:18:00Z",
      media: [],
      collections: [
        {
          slug: "design",
          url: toPublicPath(getCollectionPagePath("design"), sitePathPrefix),
          title: i18n._(
            msg({
              message: "Design",
              comment: "@context: Collection tag on sample note post",
            }),
          ),
        },
      ],
      isLastInThread: true,
      body: i18n._(
        msg({
          message: "The default accent should feel written, not branded.",
          comment:
            "@context: Plain-text body fallback for the sample note post",
        }),
      ),
    },
    {
      id: "018e2b6f-3a10-7000-8000-000000000002",
      permalink: linkPermalink,
      slug: "sample-link",
      title: i18n._(
        msg({
          message: "Editorial interfaces worth borrowing from",
          comment: "@context: Sample link post title on the theme sample page",
        }),
      ),
      bodyHtml: [
        renderParagraphWithLink(
          i18n._(
            msg({
              message:
                "This reference is useful because it treats links and citations as part of the reading rhythm. Keep that in mind while tuning the",
              comment:
                "@context: Sample link post body prefix on the theme sample page",
            }),
          ),
          notePermalink,
          i18n._(
            msg({
              message: "default note sample",
              comment:
                "@context: Inline link label in the sample link post body",
            }),
          ),
          i18n._(
            msg({
              message:
                "and checking whether the accent is guiding attention or pulling too hard.",
              comment:
                "@context: Sample link post body suffix on the theme sample page",
            }),
          ),
        ),
      ].join(""),
      summary: i18n._(
        msg({
          message:
            "A reference link for checking whether the accent feels editorial instead of promotional.",
          comment: "@context: Plain-text summary for the sample link post",
        }),
      ),
      excerpt: i18n._(
        msg({
          message:
            "A reference link for checking whether the accent feels editorial instead of promotional.",
          comment: "@context: Excerpt for the sample link post",
        }),
      ),
      url: "https://example.com/editorial-interface-notes",
      format: "link",
      status: "published",
      visibility: "public",
      pinned: false,
      featured: false,
      publishedAt: "2026-03-14T16:42:00Z",
      publishedAtFormatted: "Mar 14, 2026",
      publishedAtTime: "16:42",
      publishedAtRelative: "Mar 14",
      updatedAt: "2026-03-14T16:42:00Z",
      media: [],
      collections: [
        {
          slug: "references",
          url: toPublicPath(
            getCollectionPagePath("references"),
            sitePathPrefix,
          ),
          title: i18n._(
            msg({
              message: "References",
              comment: "@context: Collection tag on sample link post",
            }),
          ),
        },
      ],
      threadRootId: "018e2b6f-3a10-7000-8000-000000000010",
      isLastInThread: false,
    },
    {
      id: "018e2b6f-3a10-7000-8000-000000000003",
      permalink: quotePermalink,
      slug: "sample-quote",
      title: i18n._(
        msg({
          message: "Field Notes on Interface Tone",
          comment:
            "@context: Sample quote attribution title on the theme sample page",
        }),
      ),
      bodyHtml: [
        renderParagraphWithLink(
          i18n._(
            msg({
              message:
                "This is useful as a color check because it puts the accent next to quotation styling, metadata, and a quieter explanatory paragraph. Compare it back to the",
              comment:
                "@context: Sample quote commentary prefix on the theme sample page",
            }),
          ),
          notePermalink,
          i18n._(
            msg({
              message: "note treatment",
              comment:
                "@context: Inline link label in the sample quote commentary",
            }),
          ),
          i18n._(
            msg({
              message:
                "to make sure both still feel like they belong to the same product.",
              comment:
                "@context: Sample quote commentary suffix on the theme sample page",
            }),
          ),
        ),
      ].join(""),
      summary: i18n._(
        msg({
          message:
            "A quote card for judging accent color against softer, citation-heavy content.",
          comment: "@context: Plain-text summary for the sample quote post",
        }),
      ),
      excerpt: i18n._(
        msg({
          message:
            "A quote card for judging accent color against softer, citation-heavy content.",
          comment: "@context: Excerpt for the sample quote post",
        }),
      ),
      url: "https://example.com/field-notes-interface-tone",
      quoteText: i18n._(
        msg({
          message:
            "Interfaces for reading should guide the eye, not keep asking for attention.",
          comment: "@context: Sample quote text on the theme sample page",
        }),
      ),
      format: "quote",
      status: "published",
      visibility: "public",
      pinned: false,
      featured: false,
      rating: 5,
      publishedAt: "2026-03-13T11:05:00Z",
      publishedAtFormatted: "Mar 13, 2026",
      publishedAtTime: "11:05",
      publishedAtRelative: "Mar 13",
      updatedAt: "2026-03-13T11:05:00Z",
      media: [],
      collections: [
        {
          slug: "reading",
          url: toPublicPath(getCollectionPagePath("reading"), sitePathPrefix),
          title: i18n._(
            msg({
              message: "Reading",
              comment: "@context: Collection tag on sample quote post",
            }),
          ),
        },
      ],
      isLastInThread: true,
    },
  ];
  const articleDetailPost: PostView = {
    id: "018e2b6f-3a10-7000-8000-000000000004",
    permalink: articlePermalink,
    slug: "sample-article-detail",
    title: i18n._(
      msg({
        message: "Designing a calmer default accent for Jant",
        comment:
          "@context: Title for the sample detail article on the theme sample page",
      }),
    ),
    bodyHtml: [
      `<p>${escapeHtml(
        i18n._(
          msg({
            message:
              "This article is here to answer a specific question: does the default accent still feel calm once it has to carry a full reading experience?",
            comment: "@context: Opening paragraph on the sample detail article",
          }),
        ),
      )}</p>`,
      `<p>${escapeHtml(
        i18n._(
          msg({
            message:
              "A good default accent in Jant should feel like editorial structure, not product branding. That means links, emphasis, and thread cues can be visible without turning the page into UI chrome.",
            comment: "@context: Second paragraph on the sample detail article",
          }),
        ),
      )} <a href="${escapeHtml(sampleBaseHref)}">${escapeHtml(
        i18n._(
          msg({
            message: "Compare it against the theme controls",
            comment: "@context: Inline link label in the sample detail article",
          }),
        ),
      )}</a>.</p>`,
      renderFigure(
        SAMPLE_ARTICLE_IMAGE,
        i18n._(
          msg({
            message: "An abstract editorial layout in warm paper colors",
            comment: "@context: Alt text for the sample detail article image",
          }),
        ),
        i18n._(
          msg({
            message:
              "The image should sit quietly inside the article instead of feeling like a card preview.",
            comment: "@context: Caption for the sample detail article image",
          }),
        ),
      ),
      renderHeading(
        2,
        i18n._(
          msg({
            message: "What to look for while tuning it",
            comment: "@context: Section heading in the sample detail article",
          }),
        ),
      ),
      renderList("ul", [
        i18n._(
          msg({
            message:
              "Links should read clearly without glowing against the page.",
            comment: "@context: Bullet item in the sample detail article",
          }),
        ),
        i18n._(
          msg({
            message:
              "Headings should keep their hierarchy even when the accent gets softer.",
            comment: "@context: Bullet item in the sample detail article",
          }),
        ),
        i18n._(
          msg({
            message:
              "Quoted or highlighted passages should feel like annotations, not warnings.",
            comment: "@context: Bullet item in the sample detail article",
          }),
        ),
      ]),
      renderBlockquote(
        i18n._(
          msg({
            message:
              "The best default color is the one you notice only after reading for a while.",
            comment: "@context: Blockquote in the sample detail article",
          }),
        ),
      ),
      renderHeading(
        3,
        i18n._(
          msg({
            message: "A practical checklist",
            comment: "@context: Subheading in the sample detail article",
          }),
        ),
      ),
      renderList("ol", [
        i18n._(
          msg({
            message:
              "Read the page from top to bottom without looking at the swatches.",
            comment: "@context: Ordered list item in the sample detail article",
          }),
        ),
        i18n._(
          msg({
            message:
              "Open a few links and check whether they still feel native to the page.",
            comment: "@context: Ordered list item in the sample detail article",
          }),
        ),
        i18n._(
          msg({
            message:
              "Look at the footer metadata last, to make sure the accent is not fighting the typography.",
            comment: "@context: Ordered list item in the sample detail article",
          }),
        ),
      ]),
      "<hr />",
      renderTable(
        [
          i18n._(
            msg({
              message: "Surface",
              comment: "@context: Table header in the sample detail article",
            }),
          ),
          i18n._(
            msg({
              message: "What the accent should do",
              comment: "@context: Table header in the sample detail article",
            }),
          ),
        ],
        [
          [
            i18n._(
              msg({
                message: "Primary button",
                comment: "@context: Table cell in the sample detail article",
              }),
            ),
            i18n._(
              msg({
                message: "Stay sturdy and readable.",
                comment: "@context: Table cell in the sample detail article",
              }),
            ),
          ],
          [
            i18n._(
              msg({
                message: "Inline link",
                comment: "@context: Table cell in the sample detail article",
              }),
            ),
            i18n._(
              msg({
                message: "Feel editorial and slightly quieter.",
                comment: "@context: Table cell in the sample detail article",
              }),
            ),
          ],
          [
            i18n._(
              msg({
                message: "Thread accent",
                comment: "@context: Table cell in the sample detail article",
              }),
            ),
            i18n._(
              msg({
                message: "Guide the eye without taking over the layout.",
                comment: "@context: Table cell in the sample detail article",
              }),
            ),
          ],
        ],
      ),
      renderParagraph(
        i18n._(
          msg({
            message:
              "For the same reason, inline code should stay neutral. Something like theme.siteAccent = soften(green, 12%) should not suddenly become the loudest thing on the page.",
            comment:
              "@context: Paragraph mentioning code on the sample detail article",
          }),
        ),
      ),
      renderCodeBlock(`const linenAccent = {
  primary: "oklch(0.47 0.045 140)",
  siteAccent: "oklch(0.54 0.038 138)",
};`),
      renderParagraph(
        i18n._(
          msg({
            message:
              "If this article still feels like a page you want to keep reading, the palette is probably close.",
            comment: "@context: Closing paragraph on the sample detail article",
          }),
        ),
      ),
    ].join(""),
    summary: i18n._(
      msg({
        message:
          "A long-form article sample for checking the default palette in a true reading context.",
        comment: "@context: Plain-text summary for the sample detail article",
      }),
    ),
    excerpt: i18n._(
      msg({
        message:
          "A long-form article sample for checking the default palette in a true reading context.",
        comment: "@context: Excerpt for the sample detail article",
      }),
    ),
    format: "note",
    status: "published",
    visibility: "public",
    pinned: false,
    featured: true,
    rating: 5,
    publishedAt: "2026-03-12T08:40:00Z",
    publishedAtFormatted: "Mar 12, 2026",
    publishedAtTime: "08:40",
    publishedAtRelative: "Mar 12",
    updatedAt: "2026-03-12T08:40:00Z",
    media: [],
    collections: [
      {
        slug: "design",
        url: toPublicPath(getCollectionPagePath("design"), sitePathPrefix),
        title: i18n._(
          msg({
            message: "Design",
            comment: "@context: Collection tag on the sample detail article",
          }),
        ),
      },
    ],
    isLastInThread: true,
    body: i18n._(
      msg({
        message:
          "A long-form article sample for checking the default palette in a true reading context.",
        comment:
          "@context: Plain-text body fallback for the sample detail article",
      }),
    ),
  };

  return (
    <div class="theme-sample-page py-6">
      <header class="theme-sample-header mb-8 flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
            {i18n._(
              msg({
                message: "Theme sample",
                comment: "@context: Eyebrow on the public theme sample page",
              }),
            )}
          </p>
          <h1 class="text-3xl font-semibold tracking-tight">
            {i18n._(
              msg({
                message: "Tune color in a real reading context",
                comment: "@context: Title on the public theme sample page",
              }),
            )}
          </h1>
          <p class="max-w-2xl text-sm text-muted-foreground">
            {i18n._(
              msg({
                message:
                  "Use this page to judge buttons, links, cards, forms, thread accents, and quiet surfaces before changing a theme globally.",
                comment:
                  "@context: Introductory description on the public theme sample page",
              }),
            )}
          </p>
        </div>

        <section class="theme-sample-toolbar card p-6 md:p-7">
          <div class="mb-4 flex flex-col gap-1">
            <h2 class="text-base font-semibold">
              {i18n._(
                msg({
                  message: "Theme",
                  comment: "@context: Section heading for theme picker pills",
                }),
              )}
            </h2>
            <p class="text-sm text-muted-foreground">
              {i18n._(
                msg({
                  message:
                    "Switch the palette and mode without opening settings or changing the active site theme.",
                  comment:
                    "@context: Helper text for theme picker pills on the sample page",
                }),
              )}
            </p>
          </div>

          <div class="mb-4 flex flex-wrap gap-2">
            {themes.map((theme) => (
              <a
                key={theme.id}
                href={buildSampleHref(theme.id, currentMode)}
                class={isActivePill(selectedTheme.id, theme.id)}
              >
                {theme.name}
              </a>
            ))}
          </div>

          <div class="flex flex-wrap gap-2">
            {MODES.map((mode) => (
              <a
                key={mode}
                href={buildSampleHref(selectedTheme.id, mode)}
                class={isActivePill(currentMode, mode)}
              >
                {mode === "auto"
                  ? i18n._(
                      msg({
                        message: "Auto",
                        comment: "@context: Theme mode option on sample page",
                      }),
                    )
                  : mode === "light"
                    ? i18n._(
                        msg({
                          message: "Light",
                          comment: "@context: Theme mode option on sample page",
                        }),
                      )
                    : i18n._(
                        msg({
                          message: "Dark",
                          comment: "@context: Theme mode option on sample page",
                        }),
                      )}
              </a>
            ))}
          </div>
        </section>
      </header>

      <div class="theme-sample-palettes grid gap-6 xl:grid-cols-2">
        <ModePalette label="Light tokens" colors={selectedTheme.light} />
        <ModePalette label="Dark tokens" colors={selectedTheme.dark} />
      </div>

      <section class="theme-sample-showcase mt-8 grid gap-8 xl:grid-cols-[1.3fr_0.95fr]">
        <article class="card p-6 md:p-8">
          <div class="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {i18n._(
                msg({
                  message: "March 15",
                  comment: "@context: Date label on theme sample content card",
                }),
              )}
            </span>
            <span aria-hidden="true">&middot;</span>
            <span>
              {i18n._(
                msg({
                  message: "Design",
                  comment:
                    "@context: Collection label on theme sample content card",
                }),
              )}
            </span>
            <span aria-hidden="true">&middot;</span>
            <span>
              {i18n._(
                msg({
                  message: "Note",
                  comment:
                    "@context: Post format label on theme sample content card",
                }),
              )}
            </span>
          </div>

          <h2 class="mb-3 text-2xl font-semibold tracking-tight">
            {i18n._(
              msg({
                message:
                  "A softer blue feels more like ink than product chrome.",
                comment: "@context: Main sample article title",
              }),
            )}
          </h2>

          <div class="theme-sample-reading space-y-4 text-sm leading-7 text-foreground">
            <p>
              {i18n._(
                msg({
                  message:
                    "Jant looks best when the accent feels editorial. Buttons can stay sturdy, but inline emphasis should feel like a pen mark, not a dashboard highlight.",
                  comment: "@context: Body paragraph on the theme sample page",
                }),
              )}{" "}
              <a
                href={buildSampleHref(selectedTheme.id, currentMode)}
                class="content-link"
              >
                {i18n._(
                  msg({
                    message: "Read the palette as content first",
                    comment: "@context: Inline link label on sample page",
                  }),
                )}
              </a>
              .
            </p>

            <blockquote
              class="rounded-2xl border px-4 py-3"
              style="border-color:var(--site-accent);background:color-mix(in srgb, var(--site-accent) 8%, var(--card))"
            >
              <p class="font-serif text-lg leading-7">
                {i18n._(
                  msg({
                    message:
                      "The right accent should disappear into the writing until you need it.",
                    comment: "@context: Blockquote on the theme sample page",
                  }),
                )}
              </p>
            </blockquote>

            <div class="grid gap-4 md:grid-cols-3">
              <div class="rounded-xl border p-3">
                <div class="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {i18n._(
                    msg({
                      message: "Primary",
                      comment: "@context: Token label on sample page",
                    }),
                  )}
                </div>
                <div class="mt-2 rounded-lg p-3 text-sm font-medium text-center bg-primary text-primary-foreground">
                  {i18n._(
                    msg({
                      message: "Save theme",
                      comment: "@context: Filled primary button label",
                    }),
                  )}
                </div>
              </div>

              <div class="rounded-xl border p-3">
                <div class="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {i18n._(
                    msg({
                      message: "Site accent",
                      comment: "@context: Token label on sample page",
                    }),
                  )}
                </div>
                <div
                  class="mt-2 rounded-lg border px-3 py-3 text-sm font-medium text-center"
                  style="border-color:color-mix(in srgb, var(--site-accent) 36%, var(--border));color:var(--site-accent);background:color-mix(in srgb, var(--site-accent) 8%, var(--card))"
                >
                  {i18n._(
                    msg({
                      message: "Inline emphasis",
                      comment: "@context: Site accent sample badge",
                    }),
                  )}
                </div>
              </div>

              <div class="rounded-xl border p-3">
                <div class="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {i18n._(
                    msg({
                      message: "Muted",
                      comment: "@context: Token label on sample page",
                    }),
                  )}
                </div>
                <div class="mt-2 rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground text-center">
                  {i18n._(
                    msg({
                      message: "Quiet metadata",
                      comment: "@context: Muted sample label",
                    }),
                  )}
                </div>
              </div>
            </div>
          </div>
        </article>

        <aside class="space-y-6">
          <section class="card p-6 md:p-7">
            <h2 class="mb-3 text-base font-semibold">
              {i18n._(
                msg({
                  message: "Controls",
                  comment: "@context: Controls section heading on sample page",
                }),
              )}
            </h2>

            <div class="mb-4 flex flex-wrap gap-2">
              <button class="btn-primary" type="button">
                {i18n._(
                  msg({
                    message: "Publish",
                    comment: "@context: Primary button label on sample page",
                  }),
                )}
              </button>
              <button class="btn-outline" type="button">
                {i18n._(
                  msg({
                    message: "Save draft",
                    comment: "@context: Secondary button label on sample page",
                  }),
                )}
              </button>
              <button class="btn-ghost" type="button">
                {i18n._(
                  msg({
                    message: "Preview",
                    comment: "@context: Ghost button label on sample page",
                  }),
                )}
              </button>
            </div>

            <div class="mb-4 flex flex-wrap gap-2">
              <span class="badge">
                {i18n._(
                  msg({
                    message: "Default",
                    comment: "@context: Badge label on sample page",
                  }),
                )}
              </span>
              <span class="badge-secondary">
                {i18n._(
                  msg({
                    message: "Muted",
                    comment: "@context: Secondary badge label on sample page",
                  }),
                )}
              </span>
              <span class="badge-outline">
                {i18n._(
                  msg({
                    message: "Outline",
                    comment: "@context: Outline badge label on sample page",
                  }),
                )}
              </span>
              <span class="badge-destructive">
                {i18n._(
                  msg({
                    message: "Danger",
                    comment: "@context: Destructive badge label on sample page",
                  }),
                )}
              </span>
            </div>

            <div class="space-y-3">
              <label class="field">
                <span class="label">
                  {i18n._(
                    msg({
                      message: "Title",
                      comment: "@context: Input label on sample page",
                    }),
                  )}
                </span>
                <input
                  class="input"
                  type="text"
                  value={i18n._(
                    msg({
                      message: "Field notes on quiet design",
                      comment: "@context: Input value on sample page",
                    }),
                  )}
                />
              </label>

              <label class="field">
                <span class="label">
                  {i18n._(
                    msg({
                      message: "Summary",
                      comment: "@context: Textarea label on sample page",
                    }),
                  )}
                </span>
                <textarea class="textarea" rows={4}>
                  {i18n._(
                    msg({
                      message:
                        "When primary is too rigid, the whole page starts reading like product UI instead of writing space.",
                      comment: "@context: Textarea value on sample page",
                    }),
                  )}
                </textarea>
              </label>
            </div>
          </section>

          <section class="card p-6 md:p-7">
            <h2 class="mb-3 text-base font-semibold">
              {i18n._(
                msg({
                  message: "Navigation and reading states",
                  comment:
                    "@context: Navigation section heading on sample page",
                }),
              )}
            </h2>

            <div class="space-y-5">
              <div class="flex flex-wrap items-center gap-4 text-sm">
                <a
                  href={buildSampleHref(selectedTheme.id, currentMode)}
                  class="site-header-link site-header-link-active"
                >
                  {i18n._(
                    msg({
                      message: "Journal",
                      comment: "@context: Active nav link label on sample page",
                    }),
                  )}
                </a>
                <a
                  href={buildSampleHref(selectedTheme.id, currentMode)}
                  class="site-header-link"
                >
                  {i18n._(
                    msg({
                      message: "Collections",
                      comment:
                        "@context: Inactive nav link label on sample page",
                    }),
                  )}
                </a>
                <a
                  href={buildSampleHref(selectedTheme.id, currentMode)}
                  class="site-header-link"
                >
                  {i18n._(
                    msg({
                      message: "Archive",
                      comment:
                        "@context: Inactive nav link label on sample page",
                    }),
                  )}
                </a>
              </div>

              <div class="site-browse-nav py-0">
                <a
                  href={buildSampleHref(selectedTheme.id, currentMode)}
                  class="site-browse-link site-browse-link-active"
                >
                  {i18n._(
                    msg({
                      message: "Latest",
                      comment:
                        "@context: Active browse tab label on sample page",
                    }),
                  )}
                </a>
                <span class="site-browse-sep" aria-hidden="true">
                  /
                </span>
                <a
                  href={buildSampleHref(selectedTheme.id, currentMode)}
                  class="site-browse-link"
                >
                  {i18n._(
                    msg({
                      message: "Featured",
                      comment:
                        "@context: Inactive browse tab label on sample page",
                    }),
                  )}
                </a>
              </div>

              <div class="rounded-xl border p-4 text-sm">
                <div class="mb-2 font-medium">
                  {i18n._(
                    msg({
                      message: "Search snippet",
                      comment: "@context: Search snippet label on sample page",
                    }),
                  )}
                </div>
                <p class="search-snippet">
                  {i18n._(
                    msg({
                      message: "A calmer accent makes",
                      comment: "@context: Search snippet prefix on sample page",
                    }),
                  )}{" "}
                  <mark>
                    {i18n._(
                      msg({
                        message: "quiet design",
                        comment:
                          "@context: Search highlight text on sample page",
                      }),
                    )}
                  </mark>{" "}
                  {i18n._(
                    msg({
                      message: "feel deliberate instead of washed out.",
                      comment: "@context: Search snippet suffix on sample page",
                    }),
                  )}
                </p>
              </div>

              <div class="flex flex-wrap gap-2">
                <a
                  class="btn-ghost"
                  href={buildSampleHref(selectedTheme.id, currentMode)}
                >
                  {i18n._(
                    msg({
                      message: "Previous",
                      comment:
                        "@context: Pagination previous label on sample page",
                    }),
                  )}
                </a>
                <a
                  class="btn-icon-outline"
                  href={buildSampleHref(selectedTheme.id, currentMode)}
                >
                  2
                </a>
                <a
                  class="btn-icon-ghost"
                  href={buildSampleHref(selectedTheme.id, currentMode)}
                >
                  3
                </a>
                <a
                  class="btn-ghost"
                  href={buildSampleHref(selectedTheme.id, currentMode)}
                >
                  {i18n._(
                    msg({
                      message: "Next",
                      comment: "@context: Pagination next label on sample page",
                    }),
                  )}
                </a>
              </div>
            </div>
          </section>

          <section class="card p-6 md:p-7">
            <h2 class="mb-3 text-base font-semibold">
              {i18n._(
                msg({
                  message: "Thread accents",
                  comment:
                    "@context: Thread accents section heading on sample page",
                }),
              )}
            </h2>

            <div class="space-y-4">
              <div class="rounded-2xl border p-4">
                <div class="mb-3 flex items-center gap-3">
                  <span
                    class="h-3.5 w-3.5 rounded-full shrink-0"
                    style="background:var(--site-accent);box-shadow:0 0 0 4px color-mix(in srgb, var(--site-accent) 18%, transparent)"
                  />
                  <div>
                    <div class="text-sm font-medium">
                      {i18n._(
                        msg({
                          message: "Current post",
                          comment: "@context: Thread item label on sample page",
                        }),
                      )}
                    </div>
                    <div class="text-xs text-muted-foreground">
                      {i18n._(
                        msg({
                          message: "Accent should feel present, not loud.",
                          comment:
                            "@context: Thread helper text on sample page",
                        }),
                      )}
                    </div>
                  </div>
                </div>

                <a
                  href={buildSampleHref(selectedTheme.id, currentMode)}
                  class="thread-gap-link"
                >
                  {i18n._(
                    msg({
                      message: "View earlier notes in this thread",
                      comment: "@context: Thread link label on sample page",
                    }),
                  )}
                </a>
              </div>

              <div
                class="rounded-2xl border p-4"
                style="background:color-mix(in srgb, var(--site-accent) 7%, var(--card));border-color:color-mix(in srgb, var(--site-accent) 26%, var(--border))"
              >
                <div class="text-sm">
                  <div class="mb-1 font-medium">
                    {i18n._(
                      msg({
                        message: "Color check",
                        comment: "@context: Alert title on theme sample page",
                      }),
                    )}
                  </div>
                  <p class="leading-6 text-muted-foreground">
                    {i18n._(
                      msg({
                        message:
                          "If this page feels too branded, the first place to soften is the default theme’s site accent, not the border or body text.",
                        comment: "@context: Alert body on theme sample page",
                      }),
                    )}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </section>

      <section class="theme-sample-formats mt-8">
        <div class="mb-5 max-w-2xl">
          <h2 class="text-base font-semibold">
            {i18n._(
              msg({
                message: "Real post components",
                comment:
                  "@context: Section heading for real post component samples on the theme sample page",
              }),
            )}
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {i18n._(
              msg({
                message:
                  "These are actual feed components with real footers, summaries, and inline links. Use this section to judge whether the theme still feels calm once it is applied to realistic content.",
                comment:
                  "@context: Helper text for the real post component section on the theme sample page",
              }),
            )}
          </p>
        </div>

        <div class="theme-sample-feed-preview card p-6 md:p-8">
          <div class="theme-sample-feed-preview-inner space-y-8">
            <div id="sample-note">
              <TimelineItemFromPost post={samplePosts[0]} />
            </div>

            <hr class="feed-divider" />

            <div id="sample-link">
              <TimelineItemFromPost post={samplePosts[1]} />
            </div>

            <hr class="feed-divider" />

            <div id="sample-quote">
              <TimelineItemFromPost post={samplePosts[2]} />
            </div>
          </div>
        </div>
      </section>

      <section class="theme-sample-detail mt-8">
        <div class="mb-5 max-w-2xl">
          <h2 class="text-base font-semibold">
            {i18n._(
              msg({
                message: "Article detail page",
                comment:
                  "@context: Section heading for the detail article sample on the theme sample page",
              }),
            )}
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {i18n._(
              msg({
                message:
                  "This uses the real single-post detail rendering with a longer article, inline image, tables, lists, quotes, and code. The content column stays at the same width as the live site.",
                comment:
                  "@context: Helper text for the detail article sample on the theme sample page",
              }),
            )}
          </p>
        </div>

        <div class="card p-6 md:p-8">
          <div
            class="theme-sample-feed-preview-inner"
            id="sample-article-detail"
          >
            <PostPage post={articleDetailPost} />
          </div>
        </div>
      </section>
    </div>
  );
}
