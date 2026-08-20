/**
 * About Page Service
 *
 * Treats `/about` as the standard site About page. The page itself remains a
 * normal post; this service reads that convention and can create the page when
 * the author follows the settings prompt.
 */

import { ValidationError } from "../lib/errors.js";
import type { Visibility } from "../types.js";
import type { CollectionService } from "./collection.js";
import type { SmartCollectionService } from "./smart-collection.js";
import type { PathService } from "./path.js";
import type { PostService } from "./post.js";

export const ABOUT_PAGE_PATH = "/about";
export const ABOUT_PAGE_SLUG = "about";

export type AboutPageStatus =
  | {
      state: "missing";
      path: typeof ABOUT_PAGE_PATH;
    }
  | {
      state: "ready";
      path: typeof ABOUT_PAGE_PATH;
      post: {
        id: string;
        title: string | null;
        status: "draft" | "published";
        visibility: Visibility;
      };
    }
  | {
      state: "conflict";
      path: typeof ABOUT_PAGE_PATH;
      conflict: {
        targetType:
          | "collection"
          | "smart_collection"
          | "redirect"
          | "archive"
          | "post";
        id: string | null;
        title: string | null;
      };
    };

export interface AboutPageService {
  getStatus(): Promise<AboutPageStatus>;
  ensurePage(): Promise<Extract<AboutPageStatus, { state: "ready" }>["post"]>;
}

export function createAboutPageService(deps: {
  paths: PathService;
  posts: PostService;
  collections: CollectionService;
  smartCollections: SmartCollectionService;
}): AboutPageService {
  async function readStatus(): Promise<AboutPageStatus> {
    const resolved = await deps.paths.resolve(ABOUT_PAGE_SLUG);
    const base = {
      path: ABOUT_PAGE_PATH,
    } as const;

    if (!resolved) {
      return { ...base, state: "missing" };
    }

    if (resolved.targetType === "post" && resolved.postId) {
      const post = await deps.posts.getById(resolved.postId);
      if (!post) {
        return {
          ...base,
          state: "conflict",
          conflict: {
            targetType: "post",
            id: resolved.postId,
            title: null,
          },
        };
      }

      return {
        ...base,
        state: "ready",
        post: {
          id: post.id,
          title: post.title,
          status: post.status,
          visibility: post.visibility,
        },
      };
    }

    if (resolved.targetType === "collection" && resolved.collectionId) {
      const collection = await deps.collections.getById(resolved.collectionId);
      return {
        ...base,
        state: "conflict",
        conflict: {
          targetType: "collection",
          id: resolved.collectionId,
          title: collection?.title ?? null,
        },
      };
    }

    if (
      resolved.targetType === "smart_collection" &&
      resolved.smartCollectionId
    ) {
      const smartCollection = await deps.smartCollections.getById(
        resolved.smartCollectionId,
      );
      return {
        ...base,
        state: "conflict",
        conflict: {
          targetType: "smart_collection",
          id: resolved.smartCollectionId,
          title: smartCollection?.title ?? null,
        },
      };
    }

    return {
      ...base,
      state: "conflict",
      conflict: {
        targetType: resolved.targetType,
        id: null,
        title: null,
      },
    };
  }

  return {
    getStatus: readStatus,

    async ensurePage() {
      const status = await readStatus();
      if (status.state === "ready") {
        return status.post;
      }

      if (status.state === "conflict") {
        throw new ValidationError(
          "/about is already used. Rename that item before creating an About page.",
        );
      }

      const post = await deps.posts.create({
        format: "note",
        title: "About",
        slug: ABOUT_PAGE_SLUG,
        status: "published",
        visibility: "latest_hidden",
      });
      return {
        id: post.id,
        title: post.title,
        status: post.status,
        visibility: post.visibility,
      };
    },
  };
}
