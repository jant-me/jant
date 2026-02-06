/**
 * Jant Site Entry Point
 *
 * This is the main entry point for your Jant site.
 * Customize the configuration below to personalize your site.
 */

import { createApp } from "@jant/core";

export default createApp({
  // Site configuration (optional - can also be set in dashboard)
  site: {
    name: "My Blog 222",
    description: "A personal blog powered by Jant",
    language: "en",
  },

  // Theme customization (optional)
  // theme: {
  //   components: {
  //     // Override components here
  //     // PostCard: MyPostCard,
  //   },
  // },

  // Feature toggles (optional)
  // features: {
  //   search: true,
  //   rss: true,
  //   sitemap: true,
  // },
});
