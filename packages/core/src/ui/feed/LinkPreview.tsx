/**
 * Link Preview
 *
 * Renders a preview thumbnail for link posts with recognized external content.
 * For video providers (YouTube, etc.) shows a play button overlay and provider badge.
 */

import type { FC } from "hono/jsx";
import { getLinkPreviewProviderLabel } from "../../lib/link-preview.js";
import { Icon } from "../shared/Icon.js";

interface LinkPreviewProps {
  imageUrl: string;
  linkUrl: string;
  kind?: string;
  provider?: string;
}

export const LinkPreview: FC<LinkPreviewProps> = ({
  imageUrl,
  linkUrl,
  kind,
  provider,
}) => {
  const isVideo = kind === "video";
  const providerLabel = getLinkPreviewProviderLabel(provider);

  return (
    <a
      href={linkUrl}
      class="link-preview"
      target="_blank"
      rel="noopener noreferrer"
      data-preview-kind={kind}
      data-preview-provider={provider}
    >
      <img src={imageUrl} alt="" class="link-preview-image" loading="lazy" />
      {isVideo && (
        <div class="link-preview-play" aria-hidden="true">
          <Icon name="link-preview-play" class="link-preview-play-icon" />
        </div>
      )}
      {providerLabel && (
        <span class="link-preview-badge" aria-hidden="true">
          {isVideo && (
            <Icon
              name="link-preview-badge-play"
              class="link-preview-badge-icon"
            />
          )}
          {providerLabel}
        </span>
      )}
    </a>
  );
};
