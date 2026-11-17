---
"@jant/core": minor
---

A Link post shows the linked site's icon in front of its domain, and a link to a video shows the video's thumbnail with a play mark on any site that marks its pages as videos, not only YouTube. Bilibili and Vimeo links also get their provider's name on the thumbnail. When a Link post is saved, the server reads the linked page's `<head>` once: an `og:type` of `video.*` or an `og:video` tag makes it a video, and `og:image` is its thumbnail. YouTube thumbnails still come from the video id, without reading the page. The icon and the thumbnail are stored with the post and served from the site, never loaded from the linked site, so a reader's browser contacts only your site. A page that can't be read within three seconds leaves the post without a preview; the post is saved either way. Existing posts get an icon and a preview when their URL changes.

A Link post's footer no longer has its own ↗ link to the page, since the domain row above it already links there.

The HTTP API's post objects carry the icon as `previewIconUrl`.

For themes: the domain row's arrow, `<svg class="feed-link-domain-icon">`, now follows the domain instead of leading it, and a post with a site icon starts the row with `<img class="feed-link-domain-favicon">`. The row is now inline text instead of flex (`.feed-link-domain` is `display: inline-block`), and both icons use `vertical-align: middle` to sit on the middle of the domain's lowercase letters. `--site-link-icon-backdrop` sets the tile behind the icon, which only dark mode fills. The exported Hugo theme's link cards put their arrow after the host too. The footer's `<a class="post-footer-external-link">` is gone, from the site and from the exported Hugo theme.

**Upgrade notes**

- One database migration, which adds the `post.preview_icon_key` column. Run `jant migrate` before starting the new version, as on every upgrade.
