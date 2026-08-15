import type { Post } from "../types.js";
import { extractDisplayDomain } from "./url.js";
import { extractBodyText } from "./summary.js";

const TITLE_MAX_CHARS = 72;
const DESCRIPTION_MAX_CHARS = 160;

/**
 * Derive a clean plain-text projection of the body for human-facing meta.
 *
 * We cannot reuse `post.bodyText` here: that column is written with
 * `includeLinkHrefs: true` so inline link URLs land in the FTS index, which
 * pollutes the stored text with trailing URLs. Re-derive from the source
 * TipTap JSON (`post.body`) without that option.
 */
function getCleanBodyText(post: Post): string {
  // Prefer re-derivation from `post.body` (TipTap JSON). Fall back to
  // `post.bodyText` only when `body` is absent (legacy rows / fixtures);
  // without link marks in the source, there is no URL pollution to worry
  // about.
  if (post.body) return extractBodyText(post.body) ?? "";
  return post.bodyText ?? "";
}

function normalizeText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function getFirstParagraph(text: string | null | undefined): string {
  const normalized = (text ?? "")
    .split(/\n\s*\n/)
    .map((part) => normalizeText(part))
    .find((part) => part.length > 0);
  return normalized ?? "";
}

function clipText(text: string, maxChars: number): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxChars) return normalized;

  const slice = normalized.slice(0, maxChars - 3);
  const lastSpace = slice.lastIndexOf(" ");
  const clipped =
    lastSpace >= Math.floor((maxChars - 3) * 0.6)
      ? slice.slice(0, lastSpace)
      : slice;

  return `${clipped.trimEnd()}...`;
}

function getTitleCandidate(post: Post): string {
  if (post.format === "quote") {
    const quoteSnippet = getFirstParagraph(post.quoteText);
    const attribution = normalizeText(
      post.title ||
        (post.url ? extractDisplayDomain(post.url) || post.url : ""),
    );

    if (quoteSnippet && attribution) {
      return clipText(`${quoteSnippet} - ${attribution}`, TITLE_MAX_CHARS);
    }
    if (quoteSnippet) return clipText(quoteSnippet, TITLE_MAX_CHARS);
  }

  if (normalizeText(post.title)) return normalizeText(post.title);

  const summarySnippet = getFirstParagraph(post.summary);
  if (summarySnippet) return clipText(summarySnippet, TITLE_MAX_CHARS);

  const bodySnippet = getFirstParagraph(getCleanBodyText(post));
  if (bodySnippet) return clipText(bodySnippet, TITLE_MAX_CHARS);

  if (post.format === "link" && post.url) {
    return extractDisplayDomain(post.url) || post.url;
  }

  return "";
}

function getDescriptionCandidate(post: Post): string {
  if (post.format === "quote") {
    const quoteText = normalizeText(post.quoteText);
    if (quoteText) return clipText(quoteText, DESCRIPTION_MAX_CHARS);
  }

  const summaryText = normalizeText(post.summary);
  if (summaryText) return clipText(summaryText, DESCRIPTION_MAX_CHARS);

  const bodyText = normalizeText(getCleanBodyText(post));
  if (bodyText) return clipText(bodyText, DESCRIPTION_MAX_CHARS);

  const quoteText = normalizeText(post.quoteText);
  if (quoteText) return clipText(quoteText, DESCRIPTION_MAX_CHARS);

  if (post.url) return clipText(post.url, DESCRIPTION_MAX_CHARS);

  return "";
}

/**
 * What to call a Post in a list, when it may have no title of its own.
 *
 * Notes are usually untitled, so falling back to the slug would show readers
 * and authors a URL fragment where they expect a sentence. The chain is the
 * same one browser titles and Open Graph tags already use: title, then the
 * quoted text, then the summary, then the opening of the body, then a link's
 * domain.
 *
 * @param post - The Post to name
 * @returns A short plain-text label, or an empty string when there is nothing
 *   to derive one from
 * @example
 * getPostDisplayTitle(untitledNote); // "An untitled note about espresso."
 */
export function getPostDisplayTitle(post: Post): string {
  return getTitleCandidate(post);
}

export interface PostMeta {
  title: string;
  description?: string;
}

export function buildPostMeta(post: Post, siteName: string): PostMeta {
  const derivedTitle = getTitleCandidate(post);
  const derivedDescription = getDescriptionCandidate(post);

  return {
    title: derivedTitle || siteName,
    description: derivedDescription || undefined,
  };
}
