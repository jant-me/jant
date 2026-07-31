const LINK_PREVIEW_PROVIDER_LABELS: Record<string, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  bilibili: "Bilibili",
};

/**
 * Return the display label for a recognized Link preview provider.
 *
 * @param provider - Stored provider identifier, such as `youtube`
 * @returns A stable display label, or undefined for unknown providers
 * @example
 * ```ts
 * getLinkPreviewProviderLabel("youtube"); // "YouTube"
 * getLinkPreviewProviderLabel("unknown"); // undefined
 * ```
 */
export function getLinkPreviewProviderLabel(
  provider?: string,
): string | undefined {
  const normalizedProvider = provider?.trim().toLowerCase();
  return normalizedProvider
    ? LINK_PREVIEW_PROVIDER_LABELS[normalizedProvider]
    : undefined;
}
