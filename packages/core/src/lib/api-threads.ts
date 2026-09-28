/**
 * API Thread responses
 *
 * The Thread object the author API, the public API, and MCP return. One shape
 * for all three, parameterized by how each surface renders a Post and how it
 * names one: the author API's Post is the editing view, the public API's the
 * reading view.
 */

import type { ThreadSummary } from "../services/thread.js";
import type { Post } from "../types.js";
import {
  loadApiPostResponses,
  type ApiPostResponse,
  type ApiPostResponseDeps,
} from "./api-posts.js";
import {
  loadPublicPostResponses,
  type PublicPostResponse,
} from "./api-public-posts.js";
import { encodeThreadPostsCursorAfter } from "./post-list-cursor.js";
import type { PostContent } from "./schemas.js";
import { toPublicPath } from "./url.js";

/**
 * The homepage fold of one Thread: what it shows either side of the gap, and
 * how much it hides. Which replies it keeps is the site's choice
 * (`lib/thread-fold.ts`) and may change; `hidden` always says how many it left
 * out, so a caller never has to work it out.
 */
export interface ApiThreadFold<P, G> {
  /** The earliest replies, as context. */
  leading: P[];
  /** How many replies the fold leaves out, between `leading` and `trailing`. */
  hidden: number;
  /** The first reply left out, where a link to the rest opens; null if none. */
  gap: G | null;
  /** The latest replies, oldest first; the newest reply is the last. */
  trailing: P[];
}

/** One Thread, as a Thread list or lookup returns it. */
export interface ApiThreadResponse<P, G> {
  /** The Thread's ID, which is its root Post's ID. */
  id: string;
  /** Published Posts in the Thread, the root included. */
  postCount: number;
  /** Newest post in the Thread, quiet replies excluded. */
  lastActivityAt: number;
  /** Newest post in the Thread, quiet replies included. */
  threadUpdatedAt: number;
  root: P;
  /** Present when the request asked for it. */
  fold?: ApiThreadFold<P, G>;
}

/** How the author API and MCP name a Post a fold leaves out. */
export interface ApiThreadGap {
  id: string;
  slug: string;
  /** Lists the Thread's posts from this one on: the replies the fold hides. */
  cursor: string;
}

/** The author API's and MCP's Thread object. */
export type ApiAuthorThreadResponse = ApiThreadResponse<
  ApiPostResponse,
  ApiThreadGap
>;

/** How the public API names a Post a fold leaves out: with its address. */
export interface PublicThreadGap extends ApiThreadGap {
  permalink: string;
}

/** The public API's Thread object. */
export type PublicThreadResponse = ApiThreadResponse<
  PublicPostResponse,
  PublicThreadGap
>;

/**
 * Every Post a set of Thread responses renders, so their attachments and
 * counts can be read in one batch: each root, then the replies its fold shows.
 *
 * @param summaries - Threads to respond with
 * @returns The Posts, each once
 * @example
 * const responses = await render(collectThreadResponsePosts(summaries));
 */
export function collectThreadResponsePosts(summaries: ThreadSummary[]): Post[] {
  const seen = new Map<string, Post>();
  for (const { root, fold } of summaries) {
    seen.set(root.id, root);
    if (!fold) continue;
    for (const post of [
      ...fold.leadingReplies,
      ...fold.trailingReplies,
      fold.latestReply,
    ]) {
      seen.set(post.id, post);
    }
  }
  return [...seen.values()];
}

/**
 * One Thread's response, from Post responses already rendered.
 *
 * @param summary - The Thread
 * @param respond - The rendered response for a Post in it
 * @param reference - How the surface names the Post a fold leaves out, given
 *   the cursor that lists the Thread's posts from it on
 * @returns The Thread object
 * @example
 * toApiThreadResponse(summary, (post) => byId.get(post.id)!, toGap);
 */
export function toApiThreadResponse<P, G>(
  summary: ThreadSummary,
  respond: (post: Post) => P,
  reference: (post: Post, cursor: string) => G,
): ApiThreadResponse<P, G> {
  const { root, fold } = summary;
  const response: ApiThreadResponse<P, G> = {
    id: root.id,
    postCount: summary.postCount,
    lastActivityAt: root.lastActivityAt,
    threadUpdatedAt: root.threadUpdatedAt,
    root: respond(root),
  };
  if (fold === null) {
    response.fold = { leading: [], hidden: 0, gap: null, trailing: [] };
  } else if (fold) {
    response.fold = {
      leading: fold.leadingReplies.map(respond),
      hidden: fold.hiddenCount,
      gap: fold.firstHiddenReply
        ? reference(
            fold.firstHiddenReply,
            // The hidden run starts right after the last Post the fold shows
            // above it.
            encodeThreadPostsCursorAfter(fold.leadingReplies.at(-1) ?? root),
          )
        : null,
      trailing: [...fold.trailingReplies, fold.latestReply].map(respond),
    };
  }
  return response;
}

/**
 * The author API's and MCP's Thread objects for Threads already listed.
 *
 * @param deps - Services and app config
 * @param summaries - Threads to respond with, in order
 * @param options - `content: "markdown"` returns `bodyMarkdown` on every Post
 * @returns One Thread object per summary, in the same order
 * @example
 * const threads = await loadApiThreadResponses(c.var, page.threads);
 */
export async function loadApiThreadResponses(
  deps: ApiPostResponseDeps,
  summaries: ThreadSummary[],
  options: { content?: PostContent } = {},
): Promise<ApiAuthorThreadResponse[]> {
  return buildThreadResponses(
    summaries,
    (posts) => loadApiPostResponses(deps, posts, options),
    (post, cursor) => ({ id: post.id, slug: post.slug, cursor }),
  );
}

/**
 * The public API's Thread objects for Threads already listed.
 *
 * @param deps - Services and app config
 * @param summaries - Threads to respond with, in order
 * @param options - `content: "markdown"` returns `bodyMarkdown` on every Post
 * @returns One Thread object per summary, in the same order
 * @example
 * const threads = await loadPublicThreadResponses(c.var, page.threads, {});
 */
export async function loadPublicThreadResponses(
  deps: ApiPostResponseDeps,
  summaries: ThreadSummary[],
  options: { content?: PostContent } = {},
): Promise<PublicThreadResponse[]> {
  return buildThreadResponses(
    summaries,
    (posts) => loadPublicPostResponses(deps, posts, options),
    (post, cursor) => ({
      id: post.id,
      slug: post.slug,
      permalink: toPublicPath(`/${post.slug}`, deps.appConfig.sitePathPrefix),
      cursor,
    }),
  );
}

/** Render every Post the Threads show in one batch, then assemble them. */
async function buildThreadResponses<P, G>(
  summaries: ThreadSummary[],
  render: (posts: Post[]) => Promise<P[]>,
  reference: (post: Post, cursor: string) => G,
): Promise<ApiThreadResponse<P, G>[]> {
  const posts = collectThreadResponsePosts(summaries);
  const responses = await render(posts);
  const byId = new Map(
    posts.map((post, index) => [post.id, responses[index]] as const),
  );
  return summaries.map((summary) =>
    toApiThreadResponse(
      summary,
      (post) => {
        const response = byId.get(post.id);
        if (!response) throw new Error(`No response built for post ${post.id}`);
        return response;
      },
      reference,
    ),
  );
}
