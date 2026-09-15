---
"@jant/core": minor
"create-jant": minor
---

Multilingual sites, smart collections, a Subscribe page, opt-in Jant Discover, feeds that carry what the site shows, two-screen setup, and lighter pages for readers.

**New**

- **Multilingual content** (off by default): write a post in several languages, link the versions as translations, and give readers per-language views at `/en`, `/zh-hant`, and so on. A post keeps one URL in every language; `hreflang` and `<html lang>` carry the language. The translation composer shows the original above the draft.
- **Smart collections**: a collection defined by conditions instead of hand-picked posts. It has its own address, feed, API, and sitemap entry, shows its conditions to readers, and sits in navigation and the collections directory like any other collection.
- **`/subscribe`**: one page that says which feed to follow, main feed first. A Subscribe navigation entry sits beside RSS, and the author picks which to show. Each row in the collections directory links its own feed.
- **Jant Discover**: a site can opt in to the public directory of Jant blogs. Its feeds then carry a `<jant:discover>` declaration naming the feeds to read. Off by default on self-hosted sites.
- **Two-screen setup** on self-hosted sites: the account first, then the site. The new owner is signed in right away.

**Feeds**

- `<summary>` carries the timeline rendering and `<content>` the full page. Each entry also names its post kind, tags, and root post ID (`<jant:id>`), and groups attachments per post.
- A thread entry marks where each post ends with its own dated permalink, so a reader can take the thread apart.
- Quotes arrive whole, with line breaks intact.
- An unchanged feed answers `304 Not Modified`. Any feed takes `?limit=` (up to 500) for one longer or shorter read.
- A Hugo export writes `_redirects`, so existing feed subscribers keep receiving posts after the move.

**Performance**

- The author's JavaScript and CSS load only on pages that use them. Client bundles and `client.css` have size budgets, and the build fails over them.
- Assets are stored brotli-compressed at quality 11 at build time.
- Anonymous readers get only the markup they can see, and `PAGE_SIZE` defaults to 25.
- Pages can stay in the back/forward cache, and the browser connects to the asset and media hosts early.
- Attached images are processed in a worker, and the HEIC decoder loads only for HEIC files. A video already in an accepted format is copied, not re-encoded.

**Compose and editing**

- Reorder attachments by tap instead of long-press drag.
- A visible button leaves a thread in the composer.
- A post moved into or out of a thread keeps all of its fields, including a Quote's source.
- A running upload follows the text into the next editor, and the composer says when a publish is still running.
- Paste a post's address wherever a picker asks for a post.

**Reading and navigation**

- New sites put Featured and All side by side in the header and move Collections into More. Existing sites keep their navigation.
- The archive filter bar wraps into two groups when it does not fit on one line, and counts match what the current reader can see.
- Numbered pagination shows at most seven slots, and Previous/Next become arrows on phones.
- Link posts show their preview before the commentary on detail pages too. The footer stays at the bottom of a short page.
- Media stays inside the reading column, and an unrelated attachment no longer resizes a post's pictures.
- A suspended hosted site shows an offline page (503) instead of a 404.
- Sessions last 90 days and renew while in use, so an active author stays signed in.

**Upgrade notes**

- Database migrations run on deploy as usual.
- `PAGE_SIZE` now defaults to 25 (was 50). Set it to 50 to keep the old size.
- Self-hosted sites are not listed in Jant Discover unless the owner turns it on in Settings.
- Feed `<summary>` is now HTML and is left out when it would repeat `<content>`.
- New archive custom URLs can no longer be created; use a smart collection instead. Existing ones keep working.
