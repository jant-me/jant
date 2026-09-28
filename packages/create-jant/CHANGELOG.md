# create-jant

## 0.10.0

### Minor Changes

- [`42a0228`](https://github.com/jant-me/jant/commit/42a022864dde880588386799d321466c5af3c37e) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Every API error answers `{ error, code }`, the shape the API reference documents.

  **Upgrade notes**

  - No database migrations.
  - A request body that isn't JSON answers `400` with `VALIDATION_ERROR`, instead of `500`.
  - An unknown `/api` path, and `/api/public/*` while `PUBLIC_API_ENABLED=false`, answer JSON `404` with `NOT_FOUND`, instead of plain text.
  - An error the server didn't expect carries `code: "INTERNAL_ERROR"`.
  - Upload, avatar, Telegram webhook, and storage errors carry codes: `VALIDATION_ERROR`, `CONFIGURATION_ERROR` when file storage isn't set up, `MEDIA_QUOTA_EXCEEDED`, and `EXTERNAL_SERVICE_ERROR` when a write fails. The Telegram webhook's unknown-bot message is now "Telegram bot not found".
  - `RATE_LIMIT` is gone from the documented codes: no API endpoint returns it.

- [`dd12810`](https://github.com/jant-me/jant/commit/dd128106409703a7892aba33b441803d36ec20ca) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Every author API response is built from a fixed list of fields, the one `docs/API.md` shows, instead of the database row. A column added to Jant no longer turns up in the API on its own, and responses stop carrying the owning site and storage details.

  **Upgrade notes**

  - No database migrations.
  - `siteId` is gone from posts, media, collections, smart collections, collection directory items, and navigation items. A response always comes from the site you asked.
  - Posts in the author API no longer carry `previewImageKey`, `previewKind`, `previewProvider`, or `translationGroupId`; public posts no longer carry `translationGroupId`. The translation endpoints list a post's other versions.
  - Media responses no longer carry `filename`, `provider`, or `position`. `originalName` is the file's name as uploaded, and a post's `attachments` array gives the order.
  - `jant_collections_list` returns the same `collections`, `smartCollections`, and `directoryItems` as `GET /api/collections`, without the extra `items`.
  - Now documented, unchanged: `language` and `displayTitle` on posts, `description` on directory items, and `placement` and `targetTitle` on navigation items, which `POST` and `PUT /api/nav-items` also accept as `placement`.

- [`7dc7ad6`](https://github.com/jant-me/jant/commit/7dc7ad6656e77e79e1acece1d4926fe62ecfdedd) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Collection and Smart Collection pages link to their rating order as `?sort=rating`, one word like every other value in a public address. Writing and organizing now lists every archive query parameter and value, and the older spellings the archive still reads.

  **Upgrade notes**

  - No database migrations.
  - Links with `?sort=rating_desc` still open the rating order. The API keeps `rating_desc` as the `sortOrder` value.

- [`b4c02a7`](https://github.com/jant-me/jant/commit/b4c02a7ad5c2d57dd11ed1cc9aa02754561aaa32) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `GET /api/collections`, `GET /api/collections/:id`, and `GET /api/nav-items` are author endpoints, like the rest of the collection and navigation API. Readers see Collections on `/collections` and the navigation in the page header. With an API token, collection and smart collection counts now include private Threads, as they already did in a signed-in browser.

  **Upgrade notes**

  - No database migrations.
  - These three reads return `401` without a session or API token, whatever `PUBLIC_API_ENABLED` says. `PUBLIC_API_ENABLED` now only affects `/api/public/*`.

- [`881373c`](https://github.com/jant-me/jant/commit/881373c444bdda511bb0401755a2b9da9afe8f07) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The custom URLs API pages and names things the way the rest of the API does.

  **Upgrade notes**

  - No database migrations.
  - `GET /api/custom-urls` pages with `limit` (default and maximum `100`) and `cursor`, answering `{ customUrls, nextCursor }`. The `page` parameter and the `total`, `page`, and `totalPages` fields are gone.
  - `path` in responses has its leading slash, as `toPath` already did and requests already allowed.
  - `targetId` in a create request takes the post's or collection's TypeID as well as its slug. A target that doesn't exist answers `404` either way; an unknown TypeID used to fail with `500`.
  - Responses carry `archiveQuery`, and the docs describe the `archive` addresses the list already returned.

- [`6a2fc3f`](https://github.com/jant-me/jant/commit/6a2fc3fecf2095d0fd56d1ed6096ac732a1725e1) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The Docker image puts `jant` on the `PATH`, as the command-line docs say: `docker compose exec jant jant setup --help` works. `node bin/jant.js` keeps working. From 1.0.1, each release also moves a major-version tag, `owenyoung/jant:1`, so a compose file pinned to it stays on 1.x.

  **Upgrade notes**

  - No database migrations.

- [`6f34d9e`](https://github.com/jant-me/jant/commit/6f34d9e321e4074c1839c8aa3809516c88e91339) Thanks [@theowenyoung](https://github.com/theowenyoung)! - MCP tools follow one naming pattern and fail in one shape.

  **Upgrade notes**

  - No database migrations.
  - `jant_search_posts` is now `jant_posts_search`, and its `query` parameter is `q`, as in `GET /api/search`. `jant_media_update_alt` is now `jant_media_update`.
  - A failed tool call's `structuredContent` is the HTTP error shape: `{ error, code }`, with `details` for a validation error. It used to be one of four shapes; `issues` is now `details`, and `statusCode` is gone.
  - An unknown tool answers `code: "NOT_FOUND"`, and an unexpected failure `code: "INTERNAL_ERROR"`.
  - From 1.0, the compatibility promise covers what MCP tools return as well as their names and parameters.

- [`b15c5bb`](https://github.com/jant-me/jant/commit/b15c5bba591f836fd726859d051dba478c8c5cdb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Uploaded files are a resource at `/api/media`: list them, read one, change its alt text, and delete it there. `/api/upload` only uploads.

  The text attachment preview reads from its own page address, `/_/text/{id}`, and follows the rule the attachment's page `/{post}/text/{id}` already followed: the file must belong to a published post, and a private one only to the signed-in author.

  **Upgrade notes**

  - No database migrations.
  - `GET /api/upload`, `GET /api/upload/:id`, `PATCH /api/upload/:id`, and `DELETE /api/upload/:id` are now `GET /api/media`, `GET /api/media/:id`, `PATCH /api/media/:id`, and `DELETE /api/media/:id`, with the same requests and responses. `POST /api/upload` is unchanged.
  - The undocumented `GET /api/media/:id/content` is gone. It answered anyone who had a media ID, whatever the post it belonged to.
  - The preview dialog now works on a site with `SITE_PATH_PREFIX`, and shows an uploaded plain-text file as text instead of reading its contents as HTML. The attachment page `/{post}/text/{id}` also opens for an uploaded plain-text file.

- [`06ab955`](https://github.com/jant-me/jant/commit/06ab9555a0a7631021d5b321d93f7fb66640bd3a) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A text attachment carries `url`, its Markdown source file, as every other attachment does. Public posts give that instead of `contentUrl`, which pointed readers at an endpoint that needs a session or token and answered them `401`.

  **Upgrade notes**

  - No database migrations.
  - `/api/public/*` text attachments no longer carry `contentUrl`. Read the Markdown from `url`.
  - Author API and media responses keep `contentUrl`, and add `url`.

- [`38bcba1`](https://github.com/jant-me/jant/commit/38bcba12f89d3c87aba63501e93ee8e36d8b718e) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Remove the two public lists deprecated in 0.9: the `GET /api/public/posts` list and `GET /api/public/archive`. `GET /api/public/threads` replaces both. `GET /api/public/posts/:slug` stays. The 0.9 notes said 1.0.1; the removal comes a release earlier, so 1.x starts without them.

  **Upgrade notes**

  - No database migrations.
  - Requests to the `GET /api/public/posts` list and to `GET /api/public/archive` return `404`. Use `GET /api/public/threads` for what the first listed, and `GET /api/public/threads?visibility=any&sort=published` for the archive. Their Threads carry each root post in the same shape, under `root`.
  - Responses no longer carry the `Deprecation` and `Link` headers that announced the removal.

- [`c08d573`](https://github.com/jant-me/jant/commit/c08d57320ffde052b3a1fd235536ac09053123a8) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The theming page stops listing eight CSS variables that no Jant style reads, so setting them changed nothing: `--card-radius`, `--card-padding`, `--card-border-width`, `--card-shadow`, `--site-media-outline`, `--site-accent-text`, `--fw-light`, and `--fw-extrabold`.

  **Upgrade notes**

  - No database migrations.
  - These variables are no longer defined, except `--site-media-outline`, which the exported Hugo theme still reads. Custom CSS that set them had no effect, and still has none. Custom CSS that read them with `var()` gets the fallback you gave, or the property's initial value.
  - The "turn posts into cards" example is gone from the theming page; the variables it set did nothing.

- [`6d90bca`](https://github.com/jant-me/jant/commit/6d90bcae078537337d0693f48c7d845a2f4d4b00) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Every path Jant answers at the site root is now reserved, so no post, collection, or custom URL can take an address that a system route would shadow. Newly reserved: `sites`, `robots.txt`, `manifest.webmanifest`, `favicon.ico`, `apple-touch-icon.png`, and every `sitemap.xml` or `sitemap-*.xml` name.

  **Upgrade notes**

  - No database migrations.
  - An address that already uses one of these names was never reachable, since the system route answered first. It stays stored, and saving a new one is refused.

- [`10cdef3`](https://github.com/jant-me/jant/commit/10cdef3a3f483397aed27c5d30fb6e3d91cae632) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `GET /api/search` is the author's search: it needs a session or API token, finds private posts and replies in a private Thread, and each result carries `visibility`, as the `jant_search_posts` MCP tool does. Readers search on the `/search` page, where the search rate limit now applies.

  **Upgrade notes**

  - No database migrations.
  - A request to `GET /api/search` without a session or token gets `401`. Jant has no anonymous search API anymore; readers use the `/search` page. `PUBLIC_API_ENABLED` no longer affects `/api/search`.
  - `RATE_LIMIT_SEARCH_PER_MIN` now limits signed-out readers on the `/search` page. The search API and the signed-in author aren't limited.

- [`beafeb0`](https://github.com/jant-me/jant/commit/beafeb0b9ff9ba4589cd308840d620b8c9fc2523) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Smart collections name their order `sortOrder`, as collections do, with the same values, and their endpoints return the object itself.

  **Upgrade notes**

  - No database migrations.
  - In smart collection requests and responses, `sort` is now `sortOrder`. A request that still sends `sort` has it ignored, and the default order applies.
  - `GET`, `POST`, and `PUT /api/smart-collections[/:id]` return the smart collection object, no longer wrapped in `{ "smartCollection": … }`. The list keeps `{ "smartCollections": […] }`.
  - `jant site import` from this release works with sites before and after the change. An older `jant` can't import smart collections into a site on this release; update `@jant/core` first.

- [`fe78a19`](https://github.com/jant-me/jant/commit/fe78a19dcd0eeb7a023a308e9e617f89d13793ae) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `POST /api/upload` always answers JSON. It used to answer a request that sent `Accept: text/event-stream` with Datastar patches for an upload screen that no longer exists.

  **Upgrade notes**

  - No database migrations.
  - A client that asked `POST /api/upload` for `text/event-stream` gets the JSON response instead.

### Patch Changes

- [`098c6b5`](https://github.com/jant-me/jant/commit/098c6b5bab4a7d4b3c8f6ec1ea691972d2e6c943) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The API reference's "Versioning and Stability" section points to the compatibility promise instead of saying breaking changes arrive through release notes.

- [`7abb701`](https://github.com/jant-me/jant/commit/7abb701d602da0b3aff45d4b586726b4c6cd55e4) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Automation and API docs: the curl example posts a note with `bodyMarkdown` (with `body`, it answered 400), the field list names `collectionIds`, and the MCP section says which resources have tools instead of claiming one tool per endpoint. The API reference lists the `smc_` ID prefix.

- [`e815a3e`](https://github.com/jant-me/jant/commit/e815a3e1f644e932cdc128a963b850b33ffe1ec1) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant` refuses options written before the command instead of dropping them. `jant --remote migrate` used to migrate the local database, and `jant --help deploy` deployed; both now stop with a message saying where the options go.

- [`14aa67f`](https://github.com/jant-me/jant/commit/14aa67ff154ef6aa3bca7e696d1ef808c6a980eb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The compatibility page says where the promise stops: undocumented endpoints and fields aren't covered, the maintenance commands run from the server's version, a snapshot restores into the kind of database it came from, and the defaults of `PUBLIC_API_ENABLED`, `MAIN_RSS_FEED`, `RSS_FEEDS_ENABLED`, and `CORS_ORIGINS` change only in a major release. The API reference documents `PUT /api/settings/import` and the post fields `jant site import` sends: `pinnedAt`, `featuredAt`, `quietReply`, and `collectionEntries`.

- [`e6bef29`](https://github.com/jant-me/jant/commit/e6bef299f094dfa50c618de5724877f6af30f5c8) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Custom CSS overrides the built-in color and font theme, as the theming docs say. The theme wrote its values with a doubled `:root:root` selector, so `:root { --primary: … }` in custom CSS lost to it in light mode, and to the dark defaults in dark mode.

  **Upgrade notes**

  - No database migrations.
  - The theme and Jant's defaults now use `:root` for light values, and `:root[data-theme-mode="dark"]` or, under `@media (prefers-color-scheme: dark)`, `:root:not([data-theme-mode="light"])` for dark ones. Custom CSS that uses the same selectors wins. Custom CSS that worked around the old behavior with `:root:root` still wins.
  - A site set to always dark now shows its theme's own search highlight colors and dashboard background, as a site following a dark system preference already did.

- [`fb93368`](https://github.com/jant-me/jant/commit/fb93368e5e1a863f087bcc98bd4891d60df5981b) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The export and import page lists every front-matter field and `data/jant.toml` key a site export writes, and marks the ones only the bundled Hugo theme reads. The rest change only in a major release. Before, the page named a handful in prose, and everything else, `title` and `format` included, was outside the contract by omission.

- [`d581889`](https://github.com/jant-me/jant/commit/d581889ae1e2743913bfe77084b471f34f60bb95) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The MCP post tools write posts the way `POST` and `PUT /api/posts` do.

  - `jant_posts_update` works. It rejected every call with "Invalid tool arguments." because the post `id` was checked as part of the body.
  - `jant_posts_create` keeps `language`, `translationOfId`, `pinnedAt`, `featuredAt`, and `collectionEntries`, and `jant_posts_update` keeps `language`, `pinnedAt`, `featuredAt`, and `collectionEntries`. They used to be dropped without an error.
  - Creating, updating, or deleting a post through MCP starts a GitHub sync on a site that has one, as the HTTP endpoints do.

## 0.9.1

### Patch Changes

- [`68eae5d`](https://github.com/jant-me/jant/commit/68eae5d94c2c4d5ed90571712d1a901542cc8009) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Search leaves out private posts for anyone who isn't signed in. `GET /api/search` and the `/search` page filtered on publishing status only, so a private post, or a reply in a private Thread, came back to anyone who searched for words in it: its title, an excerpt around the match, its link or quote source, its slug, and its publish date.

  **Upgrade notes**

  - This is a security fix. On a site with private posts, anyone who could reach `/search` or `GET /api/search` could read those fields. No database migrations.
  - `GET /api/search` leaves out private posts for every caller, as `/api/public/*` does. A session or Bearer token doesn't add them.
  - The `/search` page includes private posts for the signed-in author, as the archive and collection pages do.
  - The `jant_search_posts` MCP tool includes private posts, and each result now carries `visibility`.
  - `GET /api/search` clamps `limit` to 1–50. A negative value, such as `limit=-1`, used to return every match on SQLite and fail on Postgres; a value below 1 now returns one result.

- [`408bc6e`](https://github.com/jant-me/jant/commit/408bc6e68a3b999b8ee20a48715b06727b695998) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Setup asks the Jant Discover question only when the content language is Chinese, the one language the jant.me directory lists. For any other language the checkbox stays off screen and setup stores no answer, so the deployment's `DISCOVER` default applies as before. The checkbox follows the language picker on the same screen. The Discover checkbox in Settings is unchanged and shows for every site.

## 0.9.0

### Minor Changes

- [`8307413`](https://github.com/jant-me/jant/commit/8307413643868f229e19c387df43ef1f7a01f3ce) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Threads become an API resource: list them, read one whole, and page through its posts, with the homepage's fold on request. Every post says how big its Thread is.

  **New**

  - `GET /api/public/threads` lists Threads. Unfiltered it lists what the homepage lists, and it takes the archive's filters plus `sort` (`activity`, `published`, `updated`, `oldest`, `rating`) and `visibility=any` for Threads hidden from Latest. `GET /api/threads` is the author's version, with every status and visibility.
  - `GET /api/public/threads/:slug` and `GET /api/threads/:id` return the Thread of any post in it. `GET …/posts` pages through its posts in Thread order.
  - `include=fold` adds the replies the homepage shows under each Thread, how many it leaves out, and the first one left out.
  - Every post response carries `threadPostCount`: the published posts in its Thread, root included.
  - MCP: `jant_threads_list`, `jant_threads_get`, `jant_threads_list_posts`.

  **Upgrade notes**

  - No database migrations.
  - `GET /api/posts` and `jant_posts_list` order published posts by `publishedAt`, newest first. They used to put pinned posts first and order the rest by Thread activity, so a reply lifted an old root past a walk's cursor. Drafts keep their last-edited order.
  - The `GET /api/public/posts` list and `GET /api/public/archive` are deprecated and will be removed in 1.0.1. Use `GET /api/public/threads`, and for the archive `GET /api/public/threads?visibility=any&sort=published`. Both answer as before until then, with `Deprecation` and `Link: rel="successor-version"` headers. `GET /api/public/posts/:slug` stays.

## 0.8.1

### Patch Changes

- [`91e1503`](https://github.com/jant-me/jant/commit/91e1503f57f34d2d776b7cd65e9b3e6a65cdfd8a) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Paging through `GET /api/public/posts` with `collection` no longer depends on the Thread a cursor was taken on. `nextCursor` now records the position itself, as it does without `collection`. If that Thread is deleted, unpublished, or taken out of the collection between requests, the walk continues; it used to end on an empty page. A `cursor` the request can't resume from returns `400` instead of an empty page: one that can't be read, one from a list in a different order, or the ID of a post that isn't in the collection or that the caller can't see. `nextCursor` is `null` on the last page instead of leading to an empty one.

  `nextCursor` is a different string now. Clients that pass it back unchanged, as the API reference says, need no change, and a Thread root's ID is still accepted as `cursor`. Under the [compatibility promise](https://jant.me/docs/compatibility) this is a bug fix: the documented contract, pass `nextCursor` back for the next page, is unchanged, and each behavior that changed broke it.

- [`91e1503`](https://github.com/jant-me/jant/commit/91e1503f57f34d2d776b7cd65e9b3e6a65cdfd8a) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Paging through `GET /api/posts`, `GET /api/public/posts` without `collection`, `GET /api/public/archive`, and the `jant_posts_list` MCP tool no longer depends on the post a cursor was taken on. `nextCursor` now records the position itself. If that post is deleted between requests, the walk continues; it used to end on an empty page. If its publish date is edited, the next page starts where the last one ended; it used to start from the post's new place, skipping or repeating posts. Passing a private post's or a draft's ID as `cursor` on a public endpoint returns `400`, as an unknown ID does, where it used to reveal whether the post existed and roughly when it was published. A cursor that can't be read, or that comes from a list in a different order, also returns `400`, and `nextCursor` is `null` on the last page instead of leading to an empty one.

  `nextCursor` is a different string now. Clients that pass it back unchanged, as the API reference says, need no change, and a post ID is still accepted as `cursor`. Under the [compatibility promise](https://jant.me/docs/compatibility) this is a bug fix: the documented contract, pass `nextCursor` back for the next page, is unchanged, and each behavior that changed broke it.

- [`b68684a`](https://github.com/jant-me/jant/commit/b68684a4482ac5deee72e9b0b1edf6adf1469e1a) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `GET /api/public/archive` orders posts by publication date, newest first, as documented and as the `/archive` page does by default. It sorted by latest thread activity, so a new reply moved an old thread to the top. Cursor pagination follows the same order.

## 0.8.0

### Minor Changes

- [`3c39a44`](https://github.com/jant-me/jant/commit/3c39a4482f02539f0c46226aabef82827009af64) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Settles what 1.0 will freeze: one name per CLI command, `--url` for the site everywhere, a compatibility page and a CLI reference, the feed namespace documented for consumers, and checks that refuse exports and snapshots from a newer Jant. The legacy multipart upload relay goes, and `@jant/core` exports only `createApp`.

  **Upgrade notes**

  Command line. Each old form below stops with the command to run instead.

  - `jant export` is now `jant db export`, `jant import-site` is `jant site import`, and `jant search-reindex` is `jant search reindex`.
  - `jant site export` and `jant site import` take the site as `--url <url>` instead of a first argument.
  - `jant site export --directory <dir>` is now `--output <dir>`. An `--output` path that doesn't end in `.zip` is a directory.
  - `jant telegram register-webhooks --base-url` is now `--url`, and falls back to `SITE_ORIGIN`.
  - `jant deploy --site-path-prefix` is now `--path-prefix`.
  - `jant migrate-text-attachments` is removed. A site created before 2026-04-16 that has text attachments and never ran it: run it on 0.7.x before upgrading.

  API and package

  - `/api/upload/multipart` is removed. Upload through the sessions at `/api/uploads`, or `/api/upload` for one request.
  - `@jant/core` exports only `createApp`, and the `@jant/core/node` subpath is gone. Run the Node server with `jant start`.

  New projects

  - `create-jant` no longer copies agent skills into `.agents/skills/` and `.claude/skills/`, where they went stale on every upgrade. `AGENTS.md` points agents at the site's `/skill.md`, `npx jant --help`, and the docs instead. Existing projects can delete both folders.
  - The template's `npm run export` script ran the SQL dump under a name that read as the site export. It is removed; run `npx jant db export`.

  **New**

  - [Compatibility](https://jant.me/docs/compatibility): what 1.0 freezes, how a deprecation works, and which installs upgrade in place (0.3.39 and later).
  - [Command line](https://jant.me/docs/cli): every public command and option. `jant --help` groups them by task.
  - [Reading a Jant feed](https://jant.me/docs/feed-reading): every `jant:` element and attribute a feed carries, for anyone writing a reader.
  - The configuration docs cover `CORS_ORIGINS`, `RATE_LIMIT_SEARCH_PER_MIN`, `RATE_LIMIT_DISABLED`, `DEFAULT_THEME`, `DEFAULT_FONT_THEME`, and `INTERNAL_ADMIN_TOKEN`.
  - `jant site import` refuses an export in a newer format, and `jant site snapshot import` a snapshot from a newer schema, before writing anything. A snapshot's `meta.json` now records the Jant version and schema that wrote it.

  **Performance**

  - The stylesheet every public page waits for drops about 120 lines of footnote styles for markup Jant stopped writing.

## 0.7.1

### Patch Changes

- [`30bb9b6`](https://github.com/jant-me/jant/commit/30bb9b68f0619ea39c1b1edfab8d8075c9c3e5b2) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Site import works again, and a move between Jant sites or to the Hugo export keeps Thread order, times, navigation, redirects, smart collections, and feed entry IDs. Large sites can export, import, and snapshot. Adds `jant setup` for installs without a browser.

  **Fixes**

  - `jant site import` failed on every export in 0.7.0 (`HTTP 400: Choose true or false.`) before writing a post. It imports again, and picks up the favicon and touch icon from the export's theme.
  - A Thread opens on its root even when a reply was created before it, as happens after an import or when an older post moves into a Thread. Featured, Collection pages, and the Featured feed no longer leave such Threads out.
  - Markdown: a line such as `Mr. Smith` or `Ps.` no longer becomes an ordered list; only digits start one, as in CommonMark. Code blocks inside list items keep their lines, CJK bold and italic survive a round trip, and a body the serializer can't write is no longer exported empty.
  - An empty settings row no longer hides the environment variable of the same name.
  - On Postgres, the custom URL list no longer skips or repeats entries between pages.
  - Snapshot media is recorded under the storage it was uploaded to, so an R2 snapshot restored onto S3 or local storage shows its images. Image transform URLs no longer contain a double slash.
  - Public pages wait on fewer consecutive D1 reads.
  - Backspace and Delete in lists follow the Notion model. A link preview has the same space below it as above.
  - A second site can reuse a GitHub account that is already authorized.

  **Export, import, and snapshots**

  - Site export, import, `pull-media`, and snapshot export and import stream their ZIP archives instead of holding them in memory, so a site with several GB of media can back up and restore. D1 snapshot export reads each table in pages.
  - A move keeps Thread order, creation and edit times, media duration, navigation placement and labels, redirect custom URLs (also written to `_redirects`), and notes on directory links. A snapshot also carries the language setup.
  - Smart collections export as their conditions, and the Hugo theme evaluates them, so a repository that keeps growing keeps them current.
  - The exported site lists Latest, Featured, and collections in Jant's order. Its feeds keep Jant's entry IDs, so subscribers don't see every post again after a move.
  - The exported site builds and deploys on Cloudflare without manual steps.

  **New**

  - `jant setup` creates the account and site from the command line, for Docker and scripted installs.
  - `/readyz` reports the build version and start time.
  - API: `createdAt` and `updatedAt` on post create, `cursor` and `nextCursor` on the media list, `durationSeconds` on upload, `description` on navigation links, and `redirectType` as a number.
  - `create-jant` sets a project up for the package manager that ran it: npm, pnpm, Yarn 1, or Yarn 2 and later.

  **Upgrade notes**

  - No database migrations and no breaking changes.

## 0.7.0

### Minor Changes

- [`f29593c`](https://github.com/jant-me/jant/commit/f29593ceded09f06bcf4a6de5f6e001dae755ab8) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Multilingual sites, smart collections, a Subscribe page, opt-in Jant Discover, feeds that carry what the site shows, two-screen setup, and lighter pages for readers.

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

## 0.6.16

### Patch Changes

- [`ed13f3d`](https://github.com/jant-me/jant/commit/ed13f3df91f5f5b1e9a01478f246ba1a04277d4d) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Composer refresh: single scroll region with full-size previews, per-row publish state, scoped settings, always-available note titles, and floating date panel. Thread activity: threads report when they last changed and the archive sorts by it. Fixes: real slugs for Korean and Japanese titles, reliable YouTube previews in feeds, SMS and phone links in rich text, archive text-only filter, draft navigation and preview editing, and error toasts that stay touchable with images restored on failed posts.

## 0.6.15

### Patch Changes

- [`5013bc9`](https://github.com/jant-me/jant/commit/5013bc90c99aa50630f5e348e83051a38dcf1e32) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Improve publishing controls, navigation and collection management, feed configuration, draft previews, editor behavior, and media playback.

## 0.6.14

### Patch Changes

- [`fc4dbdb`](https://github.com/jant-me/jant/commit/fc4dbdb88ae1dd1a6f8fdc192b9458d21f8ece46) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Improve editing, search, and responsive UI interactions.

## 0.6.13

### Patch Changes

- [`d067461`](https://github.com/jant-me/jant/commit/d0674618d0b9efcd0500b91a911630fd115d352b) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Improve compose and media handling, navigation updates, and feed ordering fixes.

## 0.6.12

### Patch Changes

- [`505d101`](https://github.com/jant-me/jant/commit/505d1014e499c1c0b8b896cbfde238c229ad638d) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Refine reading typography, reply composition, navigation workflows, and import behavior.

## 0.6.11

### Patch Changes

- [`b7197f0`](https://github.com/jant-me/jant/commit/b7197f030a62ad6e373508c4cecb73249c9dae17) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Auto-rehost pasted inline images into site storage, and fix the TipTap link editor popover not appearing on mobile tap

## 0.6.10

### Patch Changes

- [`b4c9b97`](https://github.com/jant-me/jant/commit/b4c9b97de8824b9e0047060d8e253b9b7af8d43f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Add Snow color theme with per-theme preview descriptions; split site language into separate content and dashboard languages; move deleted and orphaned compose media to a 30-day trash before purge; allow changing post format while editing and show the format selector above replies/edits; expand untitled notes inline with read more/less; add a thread filter and single-word filter params to the archive; add a top-level Manage Hosting entry; plus feed, threads, typography, footnote, and client-hydration fixes.

## 0.6.9

### Patch Changes

- [`ab64986`](https://github.com/jant-me/jant/commit/ab6498699d3a4dfeb79b144f17af5232921b1dda) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Change post format while editing and move the format selector above replies/edits; expand untitled notes inline with Read more/less; add an archive thread filter with single-word URL params; split content and dashboard language settings; reap orphaned compose media and move deleted media to a 30-day trash before purge; clipper-friendly footnote sidenotes; treat self-referential absolute nav links as internal; re-hydrate interactive behaviors in swapped-in fragments

## 0.6.8

### Patch Changes

- [#128](https://github.com/jant-me/jant/pull/128) [`4a0b3e7`](https://github.com/jant-me/jant/commit/4a0b3e704134aced078587eac03fb8db30f92cfa) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Add an archive thread filter and switch shareable filter URLs to single-word params (media/title/replies/visibility, legacy spellings still accepted); expand untitled notes in the feed with read more/less; allow switching post format while editing; add a Manage Hosting entry in Settings for hosted sites; treat self-referential absolute nav links as internal; raise the default upload size limit to 1024 MB; reap orphaned compose uploads; and fix footnote sidenote rendering and clipper recognition.

## 0.6.7

### Patch Changes

- [`e876341`](https://github.com/jant-me/jant/commit/e876341a8ee1d7ca7434d73e125441b37c4bc7ce) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Add click-to-zoom media lightbox with aspect-aware upload resizing; show server error text on upload failure; stop treating IME composition keys (e.g. CJK pinyin Escape) as app shortcuts

## 0.6.6

### Patch Changes

- [`d044bd8`](https://github.com/jant-me/jant/commit/d044bd8347e5d6d86985d611961e8fc3b13583eb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Capture video poster frames closer to the start (cap seek at 1s instead of 3s)

## 0.6.5

### Patch Changes

- [`e912c7b`](https://github.com/jant-me/jant/commit/e912c7b4af0414b3612d184e6806d45e80cd61d2) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix UI and docs

## 0.6.4

### Patch Changes

- [`d904f83`](https://github.com/jant-me/jant/commit/d904f836aa258e1d14a3c5d3390eab15fe9b2e25) Thanks [@theowenyoung](https://github.com/theowenyoung)! - better cache control

## 0.6.3

### Patch Changes

- [`d8500cc`](https://github.com/jant-me/jant/commit/d8500ccff8de31d1095851f916581ee7f04ec4a0) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix avatar UI and compose dialog long images

## 0.6.2

### Patch Changes

- [`0f6b1b1`](https://github.com/jant-me/jant/commit/0f6b1b1d3166112a7b2dace485e7571705ac75da) Thanks [@theowenyoung](https://github.com/theowenyoung)! - for greate images gallery

## 0.6.1

### Patch Changes

- [`a7d5a26`](https://github.com/jant-me/jant/commit/a7d5a265d07103ceabeb084259b726d9c2eb96fb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix UI

## 0.6.0

### Minor Changes

- [`66d9b40`](https://github.com/jant-me/jant/commit/66d9b40d34e9c61781e341bea38dd083cba55b4f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Add Telegram Bot support & fade for Threads

## 0.5.4

### Patch Changes

- [`4c96373`](https://github.com/jant-me/jant/commit/4c9637318b988d69ec0d81286753683d870a78a7) Thanks [@theowenyoung](https://github.com/theowenyoung)! - fix video upload in Safari

## 0.5.3

### Patch Changes

- [`d884f79`](https://github.com/jant-me/jant/commit/d884f79d5c8ca9f1f676115431889966dfd8783c) Thanks [@theowenyoung](https://github.com/theowenyoung)! - fix spaces

## 0.5.2

### Patch Changes

- [`3b88f47`](https://github.com/jant-me/jant/commit/3b88f478285955189ee21ba34c23a3da93971b35) Thanks [@theowenyoung](https://github.com/theowenyoung)! - add slash tips to compose dialog

## 0.5.1

### Patch Changes

- [`b5049aa`](https://github.com/jant-me/jant/commit/b5049aaa964da72a09e83d936d92b499918dfb63) Thanks [@theowenyoung](https://github.com/theowenyoung)! - fix title

## 0.5.0

## 0.4.5

### Patch Changes

- [`345c597`](https://github.com/jant-me/jant/commit/345c5976fdbaccac291fc62ac72ce4546812c5cf) Thanks [@theowenyoung](https://github.com/theowenyoung)! - image width fix

## 0.4.4

### Patch Changes

- [`6d68c81`](https://github.com/jant-me/jant/commit/6d68c811db07bb851ede743896c5f5340f5b25a2) Thanks [@theowenyoung](https://github.com/theowenyoung)! - New empty homepage

## 0.4.3

### Patch Changes

- [`229a1d8`](https://github.com/jant-me/jant/commit/229a1d875e702b86b8b34b0cd2ba4abc3114a244) Thanks [@theowenyoung](https://github.com/theowenyoung)! - post actions adapt

## 0.4.2

### Patch Changes

- [`b7a89bf`](https://github.com/jant-me/jant/commit/b7a89bf5624958a2cc32bd7b49521ed61cc43341) Thanks [@theowenyoung](https://github.com/theowenyoung)! - fix video focus

## 0.4.1

### Patch Changes

- [`b2eeb4b`](https://github.com/jant-me/jant/commit/b2eeb4b680ff4f49fe7baee833b1fd972b7bee39) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Better Compose Uploading

## 0.4.0

### Minor Changes

- [`fe2f1bb`](https://github.com/jant-me/jant/commit/fe2f1bbce353a1501dd591f1acaf4c8ea5a6dec1) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Firsr Alpha

## 0.3.50

### Patch Changes

- [`5753575`](https://github.com/jant-me/jant/commit/5753575165253a29b2ef5fc1f1d80b9c2b81adce) Thanks [@theowenyoung](https://github.com/theowenyoung)! - new version

## 0.3.49

## 0.3.48

### Patch Changes

- [`b874636`](https://github.com/jant-me/jant/commit/b874636261caac5e50ecc124850c49d803a16861) Thanks [@theowenyoung](https://github.com/theowenyoung)! - fix compose ui

## 0.3.47

### Patch Changes

- [`8af3e47`](https://github.com/jant-me/jant/commit/8af3e4744be3fe315c30fa0fef90a3265ff76281) Thanks [@theowenyoung](https://github.com/theowenyoung)! - new UI

## 0.3.46

### Patch Changes

- [`3e9c870`](https://github.com/jant-me/jant/commit/3e9c870454967fbaae7ca6f33d5bc0bf86599e09) Thanks [@theowenyoung](https://github.com/theowenyoung)! - new version

## 0.3.45

### Patch Changes

- [`99d76e7`](https://github.com/jant-me/jant/commit/99d76e7e47bee22213850c3b3393f63cbd3b4437) Thanks [@theowenyoung](https://github.com/theowenyoung)! - new version

## 0.3.44

### Patch Changes

- [`3465654`](https://github.com/jant-me/jant/commit/346565450457efcaff80b18e4951c88a4e3a2c70) Thanks [@theowenyoung](https://github.com/theowenyoung)! - new version

## 0.3.43

### Patch Changes

- [`d32dda1`](https://github.com/jant-me/jant/commit/d32dda16bd3ac706f2a3ad1d1c7c9cad66774c1b) Thanks [@theowenyoung](https://github.com/theowenyoung)! - new version

## 0.3.42

### Patch Changes

- [`769cd11`](https://github.com/jant-me/jant/commit/769cd1140c78bc318c24bddd0664cc5bc6d171b0) Thanks [@theowenyoung](https://github.com/theowenyoung)! - new version

## 0.3.41

### Patch Changes

- [`4811227`](https://github.com/jant-me/jant/commit/4811227e30777a504eb202b6083ca8ca075cdb7a) Thanks [@theowenyoung](https://github.com/theowenyoung)! - new version

## 0.3.40

### Patch Changes

- [`8093cf1`](https://github.com/jant-me/jant/commit/8093cf1f155a76f30390bcd6864cf3c8e48fca3f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - new version for starter

## 0.3.39

### Patch Changes

- [`d678f64`](https://github.com/jant-me/jant/commit/d678f64809254e46b9c2f530a14f74c261368440) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Many updates

## 0.3.38

### Patch Changes

- [`a2e2778`](https://github.com/jant-me/jant/commit/a2e2778756f315dadb305d48799495bdc4883a35) Thanks [@theowenyoung](https://github.com/theowenyoung)! - font

## 0.3.37

### Patch Changes

- [`745c808`](https://github.com/jant-me/jant/commit/745c808749879c0239299a13f46368bfee276fae) Thanks [@theowenyoung](https://github.com/theowenyoung)! - UI

## 0.3.36

### Patch Changes

- [`0dd7086`](https://github.com/jant-me/jant/commit/0dd708605b00231b2076cf7bae7ce5afb1fcdad7) Thanks [@theowenyoung](https://github.com/theowenyoung)! - new compose

## 0.3.35

### Patch Changes

- [`0668db8`](https://github.com/jant-me/jant/commit/0668db88a21c51e3823dd54d40026f533728b9cf) Thanks [@theowenyoung](https://github.com/theowenyoung)! - rss

## 0.3.34

### Patch Changes

- [`eb87147`](https://github.com/jant-me/jant/commit/eb87147997e33dc0c54f2c25baa2ba47af05d9e4) Thanks [@theowenyoung](https://github.com/theowenyoung)! - lin

## 0.3.33

## 0.3.32

## 0.3.31

### Patch Changes

- [`e6b6fd5`](https://github.com/jant-me/jant/commit/e6b6fd5b480e970d84f93019bdc9076a195cd1d8) Thanks [@theowenyoung](https://github.com/theowenyoung)! - readme

## 0.3.30

## 0.3.29

### Patch Changes

- [`830a4aa`](https://github.com/jant-me/jant/commit/830a4aa7a535be2f5e5c638b3952aa47bc19899d) Thanks [@theowenyoung](https://github.com/theowenyoung)! - all change

## 0.3.28

### Patch Changes

- [`51ac0f4`](https://github.com/jant-me/jant/commit/51ac0f41a3860ef38b8b305e2cd5ba70dde16e85) Thanks [@theowenyoung](https://github.com/theowenyoung)! - new template

## 0.3.27

### Patch Changes

- [#60](https://github.com/jant-me/jant/pull/60) [`4a34f2d`](https://github.com/jant-me/jant/commit/4a34f2de9889754a04a3ca24790e66f0d3362414) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Remove HTTPS redirect middleware for reverse proxy compatibility, fix cookie security from request protocol, disable Cloudflare inspector behind HTTP proxy, and optimize CI builds

## 0.3.26

### Patch Changes

- [#53](https://github.com/jant-me/jant/pull/53) [`1910128`](https://github.com/jant-me/jant/commit/191012896e4dfda0e5575d5fe3ae7692e1dae7e3) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Reorder appearance settings, add avatar upload with favicon generation, and make RSS feed limit configurable

## 0.3.25

### Patch Changes

- [`c1c8a29`](https://github.com/jant-me/jant/commit/c1c8a2922875768f995dc80aabaf2b4f72e7e834) Thanks [@theowenyoung](https://github.com/theowenyoung)! - New Theme

## 0.3.24

### Patch Changes

- [`f4396ce`](https://github.com/jant-me/jant/commit/f4396ce70c718e4a44f163326416d50265d81790) Thanks [@theowenyoung](https://github.com/theowenyoung)! - minimal theme

## 0.3.23

### Patch Changes

- [`4000a25`](https://github.com/jant-me/jant/commit/4000a25137b56566ae540872af32be2d8ef967dd) Thanks [@theowenyoung](https://github.com/theowenyoung)! - jant theme

## 0.3.22

### Patch Changes

- [`b18da07`](https://github.com/jant-me/jant/commit/b18da07fece1910681c8263af6a4d511d80e6f10) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix theme

## 0.3.21

### Patch Changes

- [`eb839b5`](https://github.com/jant-me/jant/commit/eb839b5a3de6f9ff36f67fad46bc1f29e30ed3b0) Thanks [@theowenyoung](https://github.com/theowenyoung)! - fix template

## 0.3.20

### Patch Changes

- [`7565608`](https://github.com/jant-me/jant/commit/7565608ac7229bcb3851b321375d4f09b7f356b0) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix readme

## 0.3.19

### Patch Changes

- [`5dda741`](https://github.com/jant-me/jant/commit/5dda741b7dca9bca574205fcd3fb09e08a865f2d) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix readme

## 0.3.18

### Patch Changes

- [`d3a32b2`](https://github.com/jant-me/jant/commit/d3a32b2be62a34d2fc7ddcc51325126091726594) Thanks [@theowenyoung](https://github.com/theowenyoung)! - fix pnpm run

## 0.3.17

### Patch Changes

- [`03bfe24`](https://github.com/jant-me/jant/commit/03bfe2464085a66eeb1418ba381cf9694055ce55) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Change readme

## 0.3.16

### Patch Changes

- [`0d35c52`](https://github.com/jant-me/jant/commit/0d35c52c3d226877efda7cebbfea1e744c8f19b2) Thanks [@theowenyoung](https://github.com/theowenyoung)! - readme

## 0.3.15

### Patch Changes

- readme

## 0.3.14

### Patch Changes

- [`27f2699`](https://github.com/jant-me/jant/commit/27f269996a01e7650af729ca7314ffee57daf721) Thanks [@theowenyoung](https://github.com/theowenyoung)! - re doc

- [`0926f70`](https://github.com/jant-me/jant/commit/0926f709a1412febfab2c938d9817185fc8672ef) Thanks [@theowenyoung](https://github.com/theowenyoung)! - cloudflare deploy

## 0.3.13

### Patch Changes

- [`989eb75`](https://github.com/jant-me/jant/commit/989eb75129831059260317262187e74a513f2f8f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - readme

## 0.3.12

### Patch Changes

- [`9c2f172`](https://github.com/jant-me/jant/commit/9c2f172e9263c95e6d2e6639913b431c926af43f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Update readme

## 0.3.11

### Patch Changes

- [`ec60fd9`](https://github.com/jant-me/jant/commit/ec60fd9f62957882dcd92489c5e4234383a740c2) Thanks [@theowenyoung](https://github.com/theowenyoung)! - New create jant

## 0.3.10

### Patch Changes

- [`b4d4797`](https://github.com/jant-me/jant/commit/b4d4797a07097cbe443f7ef04d6575b84d4dc1a8) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix create jant

## 0.2.5

### Patch Changes

- [`cc7dd4e`](https://github.com/jant-me/jant/commit/cc7dd4edeccb9aba737c5f11545ec0c45b769320) Thanks [@theowenyoung](https://github.com/theowenyoung)! - s3

## 0.2.4

### Patch Changes

- [`ad8ce6e`](https://github.com/jant-me/jant/commit/ad8ce6ebfafa9eebfff07d20da44ef5fc8d2d7ab) Thanks [@theowenyoung](https://github.com/theowenyoung)! - media improve

## 0.2.3

### Patch Changes

- [`9a7e08e`](https://github.com/jant-me/jant/commit/9a7e08e932c3d3896a303ef25825e7f2d0645bc3) Thanks [@theowenyoung](https://github.com/theowenyoung)! - collection and

## 0.2.2

### Patch Changes

- [`51f0367`](https://github.com/jant-me/jant/commit/51f03674e5324f3bfe1e71ca1b34e169c50179eb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - update /setup

## 0.2.1

### Patch Changes

- [`8c86db9`](https://github.com/jant-me/jant/commit/8c86db9b970d24213235ca841a8522788219da2a) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Update template

## 0.2.0

### Minor Changes

- [`6870aa1`](https://github.com/jant-me/jant/commit/6870aa12c5cd32c9529d5caa9bdd957d43716037) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Architecture is nice now.

## 0.1.24

### Patch Changes

- [`6a421ae`](https://github.com/jant-me/jant/commit/6a421ae06426314da0c87d08656392c2b39ca498) Thanks [@theowenyoung](https://github.com/theowenyoung)! - fix d1

## 0.1.23

### Patch Changes

- [`858465b`](https://github.com/jant-me/jant/commit/858465ba86be4a47e8efcc4632fb32d7c0a87d21) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Skip confirm for creating database

## 0.1.22

### Patch Changes

- [`6e2bc2f`](https://github.com/jant-me/jant/commit/6e2bc2f0dae8871278cb62e9eb4d705e7e31f7ce) Thanks [@theowenyoung](https://github.com/theowenyoung)! - fix create jant

## 0.1.21

### Patch Changes

- [`3b983cd`](https://github.com/jant-me/jant/commit/3b983cd60e371f1688829c84037e5abb9f110307) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Support Theme

## 0.1.20

### Patch Changes

- [`3bfb176`](https://github.com/jant-me/jant/commit/3bfb176b3f93c9eac6cc5966a46110b360502a27) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix createApp

## 0.1.19

### Patch Changes

- [`5e168fe`](https://github.com/jant-me/jant/commit/5e168fe8238e253dbb1e64c4f7dd5aa590d1e349) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix template tsconfig

## 0.1.18

### Patch Changes

- [`81af93c`](https://github.com/jant-me/jant/commit/81af93c8321b497f86c838fa3b18560d2a4fc430) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix tsconfig

## 0.1.17

### Patch Changes

- [`b2f299d`](https://github.com/jant-me/jant/commit/b2f299dbea6e924a0fc17ec5fb51af8c89902a2f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix tsconfig

## 0.1.16

### Patch Changes

- [`108090b`](https://github.com/jant-me/jant/commit/108090b52e8af0cb690cb99e24b3d2bd5d2a196b) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix i18n

## 0.1.15

### Patch Changes

- [`d43a020`](https://github.com/jant-me/jant/commit/d43a020e13e54823dc580df4e94f8e6096393484) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Reflactor

## 0.1.14

### Patch Changes

- Fix css

## 0.1.13

### Patch Changes

- Fix css

## 0.1.12

### Patch Changes

- Fix css, Remove vite from core

## 0.1.11

### Patch Changes

- fix css

## 0.1.10

### Patch Changes

- Fix css

## 0.1.9

### Patch Changes

- Fix CSS

## 0.1.8

### Patch Changes

- Fix css

## 0.1.7

### Patch Changes

- Fix css

## 0.1.6

### Patch Changes

- fix css

## 0.1.5

### Patch Changes

- refletor css import

## 0.1.3

### Patch Changes

- Build: Pre-compile @jant/core before publishing
  - @jant/core now ships compiled JavaScript instead of TypeScript source
  - Includes TypeScript declaration files (.d.ts) for type support
  - Fixes "React is not defined" error in user projects
  - No special Vite configuration needed in user projects

## 0.1.2

### Patch Changes

- [#8](https://github.com/jant-me/jant/pull/8) [`ce638f2`](https://github.com/jant-me/jant/commit/ce638f20f856deffb745b64a83a801561dd37f25) Thanks [@theowenyoung](https://github.com/theowenyoung)! - create with auth secret

## 0.1.1

### Patch Changes

- [`bbf82aa`](https://github.com/jant-me/jant/commit/bbf82aa29324637ae2d207efdb82c6bea12c86d9) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Test CI Release

## 0.1.0

### Minor Changes

- [`008ac1d`](https://github.com/jant-me/jant/commit/008ac1d64db88f3ec12b6e39746e9ce150c98cee) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Test CI

## 0.0.4

### Patch Changes

- [`5a87c0a`](https://github.com/jant-me/jant/commit/5a87c0a87f02de9ce5bd9593fafec97bcffd43ad) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Test CI Release

## 0.0.3

### Patch Changes

- [`46001f5`](https://github.com/jant-me/jant/commit/46001f5e5336ad3b9f5b80cffa75d8dad19a9435) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Test auto merge

## 0.0.2

### Patch Changes

- [`8c06228`](https://github.com/jant-me/jant/commit/8c062288fca97a3df153871b561ec4bb126e62eb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Test Release
