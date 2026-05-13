import type { PostView } from "../../types.js";

export function getThreadPreviewState({
  secondReply,
  penultimateReply,
  latestReply,
  totalReplyCount,
}: {
  secondReply?: PostView;
  penultimateReply?: PostView;
  latestReply: PostView;
  totalReplyCount: number;
}) {
  const visibleReplyIds = new Set(
    [secondReply, penultimateReply, latestReply]
      .filter((post): post is PostView => post !== undefined)
      .map((post) => post.id),
  );
  const hiddenCount = Math.max(0, totalReplyCount - visibleReplyIds.size);

  return {
    hiddenCount,
  };
}
