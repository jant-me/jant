/**
 * Timeline Feed
 *
 * Flat list of posts separated by lightweight dividers.
 */

import type { FC } from "hono/jsx";
import type { TimelineFeedProps, TimelineItemView } from "../../types.js";
import { TimelineItem } from "./TimelineItem.js";
import { ThreadPreview } from "./ThreadPreview.js";
import { CuratedThreadPreview } from "./CuratedThreadPreview.js";
import { PagePagination } from "../shared/Pagination.js";

interface TimelineFeedItemContentProps {
  item: TimelineItemView;
}

interface TimelineFeedItemProps extends TimelineFeedItemContentProps {
  showDivider?: boolean;
}

export const TimelineFeedItemContent: FC<TimelineFeedItemContentProps> = ({
  item,
}) => {
  return item.curatedThread ? (
    <CuratedThreadPreview curatedThread={item.curatedThread} />
  ) : item.threadPreview ? (
    <ThreadPreview rootPost={item.post} {...item.threadPreview} />
  ) : (
    <TimelineItem item={item} />
  );
};

export const TimelineFeedItem: FC<TimelineFeedItemProps> = ({
  item,
  showDivider = false,
}) => {
  return (
    <div
      class="feed-item"
      data-timeline-item
      data-timeline-item-id={item.post.id}
      data-thread-root-id={item.post.threadRootId ?? item.post.id}
    >
      {showDivider && <hr class="feed-divider" />}
      <div data-timeline-item-content>
        <TimelineFeedItemContent item={item} />
      </div>
    </div>
  );
};

export const TimelineFeed: FC<TimelineFeedProps> = ({
  items,
  baseUrl,
  currentPage,
  totalPages,
}) => {
  return (
    <div data-feed>
      <div id="timeline-feed">
        <div id="timeline-items" class="flex flex-col">
          {items.map((item, i) => (
            <TimelineFeedItem
              key={item.post.id}
              item={item}
              showDivider={i > 0}
            />
          ))}
        </div>
      </div>
      {currentPage !== undefined &&
        totalPages !== undefined &&
        totalPages > 1 && (
          <PagePagination
            baseUrl={baseUrl}
            currentPage={currentPage}
            totalPages={totalPages}
          />
        )}
    </div>
  );
};
