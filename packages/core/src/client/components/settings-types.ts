/**
 * Shared types for settings Lit components and bridge script
 */

/** Translated labels for the settings UI */
export interface SettingsLabels {
  // Avatar
  blogAvatar: string;
  uploadAvatar: string;
  remove: string;
  confirmRemoveAvatar: string;
  avatarHelp: string;
  displayInHeader: string;
  processing: string;
  uploading: string;
  uploadError: string;

  // General
  general: string;
  site: string;
  aboutPage: string;
  aboutPagePrompt: string;
  aboutPageConflict: string;
  createAboutPage: string;
  editAboutPage: string;
  timeSection: string;
  home: string;
  search: string;
  siteName: string;
  aboutBlog: string;
  aboutBlogHelp: string;
  siteFooter: string;
  footerHelp: string;
  feeds: string;
  mainRssFeed: string;
  mainRssFeedHelp: string;
  mainRssFeedWarning: string;
  availableFeedUrls: string;
  availableFeedUrlsHelp: string;
  feedsDocs: string;
  mainFeedUrl: string;
  latestFeedUrl: string;
  featuredFeedUrl: string;
  archiveFeedUrl: string;
  archiveFeedUrlHelp: string;
  latestFeedOption: string;
  latestFeedOptionDescription: string;
  featuredFeedOption: string;
  featuredFeedOptionDescription: string;
  showJantBrandingOnHome: string;
  markdownSupported: string;
  timeZone: string;

  // Search
  allowIndexing: string;
  demoSeoLocked: string;

  // Actions
  save: string;
  cancel: string;
  copy: string;
  copyFailed: string;
  feedUrlCopied: string;
}

/** Timezone entry for the select dropdown */
export interface SettingsTimezone {
  value: string;
  label: string;
}

export interface SettingsInitialData {
  siteName: string;
  siteDescription: string;
  mainRssFeed: string;
  timeZone: string;
  siteFooter: string;
  showJantBrandingOnHome: boolean;
  noindex: boolean;
}

export type SettingsAboutPageStatus =
  | {
      state: "missing";
      path: "/about";
    }
  | {
      state: "ready";
      path: "/about";
      post: {
        id: string;
        title: string | null;
        status: "draft" | "published";
        visibility: "public" | "latest_hidden" | "private";
      };
    }
  | {
      state: "conflict";
      path: "/about";
      conflict: {
        targetType: "collection" | "redirect" | "archive" | "post";
        id: string | null;
        title: string | null;
      };
    };

/** Event detail dispatched when a settings form is saved */
export interface SettingsSaveDetail {
  endpoint: string;
  data: Record<string, unknown>;
  section: string;
}

/** Event detail dispatched when avatar remove is requested */
export interface AvatarRemoveDetail {
  endpoint: string;
}
