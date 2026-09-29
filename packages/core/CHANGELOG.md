# @jant/core

## 0.11.0

### Minor Changes

- [`a5b641e`](https://github.com/jant-me/jant/commit/a5b641ee17e1656a55113b704f3ba0ad8eb59a7e) Thanks [@theowenyoung](https://github.com/theowenyoung)! - **Upgrading from 0.10.** This release makes the last changes before 1.0 to what 1.0 will keep. What to check, by who you are; the entries below give the details.

  - **Everyone:** check your environment before upgrading, since a value the Settings pages would refuse now stops the site, such as `NOINDEX=1` in place of `true`. Replace `RATE_LIMIT_DISABLED=true` with `RATE_LIMIT_ENABLED=false`. An empty `CORS_ORIGINS=` now turns cross-origin access off. Keep CLI settings in `.env`, not `.env.node`. Run `jant migrate` once (`jant migrate --remote` on Cloudflare), or deploy with `jant deploy`, for two data backfills. One turns a Jant Discover choice of featured posts only off; turn Discover on again in Settings if you want to stay listed.
  - **Cloudflare template sites:** replace the migrate and deploy steps in `.github/workflows/deploy.yml` with `npx jant deploy`, and fix the line in its "Check deploy prerequisites" step that reads `database_id`, which has skipped every deploy since March; copying the file from a new project does both. Add `keep_vars = true` to `wrangler.toml`, and check that variables you set in the Cloudflare dashboard are still there. `jant db export --remote` works on D1 again.
  - **Node and Docker:** set `TRUST_PROXY=true` behind a reverse proxy, or every visitor shares one sign-in limit. With `docker run`, run `jant migrate` after each image update. A SQLite backup takes every `jant.sqlite*` file, and a restore deletes them all first; see the backup guide.
  - **API and MCP clients:** pass `nextCursor` back as it is, since post and media IDs are no longer cursors. Update media with `PUT`, not `PATCH`. Read Markdown with `?content=markdown` in place of `/content`. Uploads answer `201` with the media object. `pinnedAt`, `featuredAt`, and `rating` take numbers only. Appearance settings go to `PUT /api/settings`. A `mediaId` already attached to another post answers `409`; upload the file again for a second post.
  - **Custom CSS:** rename `--site-elevated-bg` to `--site-page-bg`, `--site-nav-hover-bg` to `--site-subtle-bg`, and `--search-mark-*` to `--site-search-mark-*`. `data-page` sits on `<body>`.
  - **Exports and your own Hugo templates:** a Collection page's `summary_text` is `description`, and media entries no longer carry `provider`, `storage_key`, or `poster_key`. An export from this release doesn't import into 0.10 or earlier.
  - **Addresses:** a post or Collection with several custom URLs lives at the oldest one. A custom URL starting with `_` or `.` no longer resolves; give the post a new one.

  **Upgrade notes**

  - No database migrations. `jant migrate` runs two data backfills.

- [`bda15dd`](https://github.com/jant-me/jant/commit/bda15dd567adc07ae6595e2f9d0d4366358d9c75) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A list's `limit` past either end of its range now reads as that end on every endpoint and MCP tool, as search already did: `limit=500` on a list of at most 100 returns 100, and `limit=0` returns one. Other lists answered `400`. A `limit` that isn't an integer answers `400` everywhere, search included, where it used to fall back to 20.

  **Upgrade notes**

  - No database migrations.
  - Search error messages name the parameter: `Query parameter 'q' is longer than 200 characters` replaces `Query too long`.

- [`f69ee4e`](https://github.com/jant-me/jant/commit/f69ee4ef2ee41d90375fb25b0a494db2d440153b) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant start` and the `jant` commands read `.env` in the current directory, the file the Node and Docker docs and templates use. The commands used to look for `.env.node`, and `jant start` read no file. `JANT_ENV_FILE` names a different file, or none when empty; it is now in the configuration reference.

  **Upgrade notes**

  - No database migrations.
  - If you kept CLI settings in `.env.node`, rename it to `.env`, or set `JANT_ENV_FILE=.env.node`.

- [`b123c23`](https://github.com/jant-me/jant/commit/b123c23b4d8a3625591332667e19a62518232bec) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant --version` prints the installed version; it used to print the help. An option a command doesn't take, or one missing its value, is answered with one line naming it and where to find the command's options, instead of a Node stack trace, and exits with status 1.

  **Upgrade notes**

  - No database migrations.

- [`076de80`](https://github.com/jant-me/jant/commit/076de80c66bb011255c0935abd5f5c42e27d54c7) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A Collection's or Smart Collection's page in a site export names its description `description`, the word its settings use. It was `summary_text`, the name posts use for a summary Jant derives. `jant site import` reads both, so older exports still import.

  **Upgrade notes**

  - No database migrations.
  - A Hugo template of your own that read `.Params.summary_text` on a Collection page reads `.Params.description`.

- [`9bc45a2`](https://github.com/jant-me/jant/commit/9bc45a281b21c7549a23fd23834ea8449b91c46d) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Collection endpoints answer for targets that don't exist. Deleting a directory item that isn't there returns `404`, not `200`. Removing, pinning, or unpinning a Thread in a Collection that doesn't exist returns `404`, as adding one already did, and pinning a Thread that isn't in the Collection returns `409` instead of reporting success with nothing pinned.

  **Upgrade notes**

  - No database migrations.
  - A client that treated `200` as success for these calls gets `404` for a Collection or directory item that doesn't exist, and `409` for pinning a Thread the Collection doesn't hold.

- [`c75cf05`](https://github.com/jant-me/jant/commit/c75cf05df75a5b47ee7bf0b30ec037f70568f125) Thanks [@theowenyoung](https://github.com/theowenyoung)! - An empty `CORS_ORIGINS` turns cross-origin API access off, as the configuration reference says. It used to be read as unset, which allows every origin.

  **Upgrade notes**

  - No database migrations.
  - If you set `CORS_ORIGINS=` to an empty value, cross-origin requests to the API now get no CORS headers. Leave the variable out, or set it to `*`, to keep allowing every origin.

- [`9a6ef35`](https://github.com/jant-me/jant/commit/9a6ef35d60951fe158c6fc26095fee938f5670a2) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A custom URL can redirect to another site, as the Settings form suggests: `toPath` takes a full `http://` or `https://` address and redirects to it as given. A redirect to a path on the site keeps the target's query string. Both were mangled before: `https://Example.com/Page` redirected to `/https:/example.com/page`, and `/archive?format=Note` lost the case of `Note`. An unparseable address is refused with `400`.

  **Upgrade notes**

  - No schema migrations. `jant migrate` runs a data backfill that restores the `//` after `https:` and `http:` in redirects already saved to another site. Their letter case was lowercased when they were saved and stays lowercase; edit any that need it.
  - A site export writes such a redirect's `to` as the full address, without a leading slash.

- [`8557b5e`](https://github.com/jant-me/jant/commit/8557b5eacb020a18c3e1b71c95af1ffe21224eaf) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `data-page` is on `<body>`, once per page, so a theme can style a page's header and footer by page as well as its content. It sat on each page's wrapper, and a post page also put `data-page="post"` on every post in the Thread, so a rule meant for the page matched each post again.

  **Upgrade notes**

  - No database migrations.
  - A rule of the form `[data-page="…"] …` keeps working. One that relied on `data-page` sitting on the same element as another attribute, such as `[data-page="collection"][data-collection-mode="smart"]`, needs a space: `[data-page="collection"] [data-collection-mode="smart"]`. One that matched `article[data-page="post"]` should use `[data-page="post"] article[data-post]`.

- [`de9c0b3`](https://github.com/jant-me/jant/commit/de9c0b36aaf92d79bf15e89eee56b0a0f9d8bbf7) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Jant Discover has two answers, `latest` and `off`. Earlier releases also let a site offer a directory only its featured posts; that choice left the settings some time ago, and sites that made it kept declaring `featured`. A backfill now turns a stored `featured` off, rather than reading it as `latest`, which would let a directory list posts the owner hadn't offered. Feeds declare `latest` or `none`, and the `feed` attribute appears with `latest` only.

  **Upgrade notes**

  - `jant migrate` runs backfill 0008, which turns a stored `featured` Discover choice off. If your site offered Discover its featured posts, turn Discover on again under Settings → General to be listed; the directory then reads every public post and decides which list each one reaches.
  - A directory reading `<jant:discover>` sees `latest` or `none` from this release on.

- [`af3edcd`](https://github.com/jant-me/jant/commit/af3edcd98d14083bfbb5c5fb583f5e2d041c010e) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Jant checks environment values at startup. A switch takes `true` or `false` in any case, a number has to be a whole number in its range, and a variable with a fixed set of values has to name one of them; `SITE_ORIGIN` has to be an `http://` or `https://` origin. A value outside that stops the site from serving and is named on the configuration error page, in `/readyz`, and, on Node and Docker, in the message the process exits with.

  The site and `GET /api/settings` now read these values the same way. `PUBLIC_API_ENABLED=TRUE` turned the public API off while the settings API reported it on, and a page size the site couldn't use ran as 50 while the settings API reported 25.

  **Upgrade notes**

  - No database migrations.
  - Check your environment before upgrading: any value the Settings pages would refuse now stops the site. Values that used to be ignored or read as a default and now stop it include:
    - a switch set to `1`, `0`, `yes`, or `on`, such as `NOINDEX=1` or `PUBLIC_API_ENABLED=1` (use `true` or `false`; `1` used to read as off)
    - `STORAGE_DRIVER=S3` (use `s3`) and `DISCOVER=featured` (use `latest` or `off`)
    - a number outside its range or with a fraction: `PAGE_SIZE` or `ARCHIVE_PAGE_SIZE` above `100`, `RSS_FEED_LIMIT` above `200`, `SUMMARY_MAX_CHARS=0`, `UPLOAD_MAX_FILE_SIZE_MB=0.5`, a `SLUG_ID_LENGTH` outside `3` to `32`
    - a `SITE_ORIGIN` without `https://` or with a path (put the path in `SITE_PATH_PREFIX`)
    - a `SITE_LANGUAGE` that isn't a language tag, such as `zh_CN` (use `zh-CN`), and a `MAIN_RSS_FEED` or `DASHBOARD_LANGUAGE` outside its options
  - The error page, `/readyz`, and the Node exit message name each variable and what it takes.

- [`96716d6`](https://github.com/jant-me/jant/commit/96716d609aef98ddf4ca742e5c8479fc75acf351) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A site export keeps the custom URLs that point at a Collection, and `jant site import` adds them again. A Collection's page lists them under `aliases`, and the exported Hugo site redirects from each. They used to be left out, so those addresses answered `404` on the imported site.

  **Upgrade notes**

  - No database migrations.

- [`f24eb26`](https://github.com/jant-me/jant/commit/f24eb26ec55899c916d7499f5eab8c51e2836131) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A site export no longer writes where the source site stored each file. The `provider`, `storage_key`, and `poster_key` fields are gone from every `media` entry; neither the bundled theme nor `jant site import` read them. The file reference now marks as theme only the fields import never reads: a post's `summary_text`, a media entry's `id`, the `title` inside a post's `collections` and inside `directory` entries, and `favicon_version`.

  **Upgrade notes**

  - No database migrations.
  - A Hugo template of your own that read `provider`, `storage_key`, or `poster_key` gets nothing. Use `src` and `poster`.

- [`974024f`](https://github.com/jant-me/jant/commit/974024fd3c25fe5c6df21ca57332c5610c97717c) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The site export's format version now rises whenever `site import` starts reading something new, so an older Jant refuses a newer export instead of importing it and dropping the fields it doesn't know. Compatibility says so. This release's import reads the time zone, main feed, languages, and a Collection page's `description`, so exports now carry format version 2.

  **Upgrade notes**

  - No database migrations.
  - An export from this release doesn't import into 0.10.0 or earlier: the import stops before writing anything and asks you to upgrade `@jant/core`. Exports from earlier releases still import here.

- [`75a6a0a`](https://github.com/jant-me/jant/commit/75a6a0a93e972a158f7b3e4eb3c86d5b1788a1d3) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Every path in a site export starts with a slash. A custom URL's `path` in `data/jant.toml` was written without one, unlike its `to`, the root aliases, and the API. `jant site import` reads both spellings.

  **Upgrade notes**

  - No database migrations.

- [`7dd3b8e`](https://github.com/jant-me/jant/commit/7dd3b8efa9aa4f306846511ad0c9fe760c091855) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A site export and import keep the time zone, the main feed, and the site's languages. `data/jant.toml` gains `time_zone`, and `jant site import` restores `time_zone`, `main_rss_feed`, `additional_languages`, and `multilingual_enabled`; the last three were written before but only the theme read them. `PUT /api/settings/import` takes `ADDITIONAL_LANGUAGES` and `MULTILINGUAL_ENABLED` and applies them with the same checks as adding a language in Settings.

  **Upgrade notes**

  - No database migrations.
  - Importing an older export now restores its main feed and languages, which used to be left at the target site's values.

- [`e32c45f`](https://github.com/jant-me/jant/commit/e32c45f4bcbe0a8181b34022b893c0e8515b5b23) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A feed entry's `<category>` elements carry `scheme`, the address of the site's collections directory, so a consumer can tell a collection from any other kind of category a later release adds.

  **Upgrade notes**

  - No database migrations.

- [`1dffbd7`](https://github.com/jant-me/jant/commit/1dffbd7aaaf8a2ccce6d21f8f43d5ae1c4f63498) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `/latest/feed?format=note` names itself with the filter: its `rel="self"` link, its feed `<id>`, and its links to the same feed in other languages keep `?format=note`, as the archive feed's do. They pointed at the unfiltered feed, so a reader that follows `rel="self"` switched feeds.

  **Upgrade notes**

  - No database migrations.
  - A subscription to a filtered latest feed gets a new feed `<id>`; some readers show it as a new feed.

- [`87a3b59`](https://github.com/jant-me/jant/commit/87a3b5939f9de7de6003f00ac5080674f49efb27) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant site import` and `jant site pull-media` read only what an export may reach. A media path in front matter must stay inside the export's `static/` directory; `../../.ssh/id_rsa` used to be read and uploaded as a public attachment. A linked file is fetched only from a public http(s) address, checked again at every redirect, so an export can't make the command fetch from the machine's own network.

  **Upgrade notes**

  - No database migrations.
  - Media an export links to on `localhost` or a private address is no longer fetched. Export with media bundled, the default for `jant site export`, to move such files.

- [`4fdb385`](https://github.com/jant-me/jant/commit/4fdb38512745c11fd0d7a0a6b0f6dc5396d68a52) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The Thread lists' `include` skips a value it doesn't offer instead of answering `400`. It's the parameter later releases add values to, and a site keeps running the release it was deployed with, so a client asking an older site for a newer extra now gets the Threads and the extras that site has, as it does for any parameter it doesn't know.

  **Upgrade notes**

  - No database migrations.

- [`9dca72e`](https://github.com/jant-me/jant/commit/9dca72ea178ccd2808e2a706315f3f3a0ee1ffd1) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Sign-in and setup are rate limited. Sign-in allows 20 attempts from one client and 10 for one account in 10 minutes; setup allows 20 submissions from one client. Password guesses used to be unlimited. On a demo site, where every visitor signs in to one published account, only the per-client limit applies.

  better-auth's own sign-in, `POST /api/auth/sign-in/email`, counts against the same limits, so it no longer takes unlimited guesses either. A limited attempt there answers `429` with an `X-Retry-After` header, as better-auth's own limiter does.

  On Node, a rate limit now counts the address Jant can vouch for. Without `TRUST_PROXY`, `X-Forwarded-For` and `CF-Connecting-IP` from the client are ignored and the connecting address is used; behind a trusted proxy, the last `X-Forwarded-For` entry, the one the proxy added. The first entry used to count, and a client could change it on every request.

  **Upgrade notes**

  - No database migrations.
  - `RATE_LIMIT_ENABLED=false` turns these limits off along with the search limit.
  - A Node deployment behind a reverse proxy without `TRUST_PROXY=true` counts every visitor as the proxy's address, so they share one sign-in limit. Set it when a proxy sits in front, as the Docker setup does.

- [`e6899d8`](https://github.com/jant-me/jant/commit/e6899d8d7b2b734a76e418dcda7c5ae0312bb626) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Each MCP tool's input schema in `tools/list` is generated from the schema the tool checks its arguments with, so the two can't disagree. `jant_posts_create` now lists `language`, `translationOfId`, `pinnedAt`, `featuredAt`, and `collectionEntries`, which it accepted but didn't advertise, and `jant_threads_list` lists `any` among its `visibility` values.

  **Upgrade notes**

  - No database migrations.

- [`f857266`](https://github.com/jant-me/jant/commit/f8572661744b4ece233a05125c575bf7d18a0261) Thanks [@theowenyoung](https://github.com/theowenyoung)! - MCP tools answer what their HTTP endpoints return. `jant_posts_get` adds `threadPosition`, as `GET /api/posts/:id` does, which now documents it. The post list tools and `jant_posts_create` and `jant_posts_update` leave out `collectionIds`, as the HTTP list, create, and update do; read a post to get them. `jant_settings_update` includes `rejectedKeys` only when some were rejected.

  **Upgrade notes**

  - No database migrations.
  - An agent that read `collectionIds` from a list, create, or update result calls `jant_posts_get` for them.

- [`49c3898`](https://github.com/jant-me/jant/commit/49c3898329e139b9f7d30fe2761de063e6dfc7a4) Thanks [@theowenyoung](https://github.com/theowenyoung)! - An uploaded media item belongs to one post. Creating or updating a post with a `mediaId` that's attached to another post answers `409` with `CONFLICT`, over HTTP and MCP. It used to move the attachment off the other post without a word, and deleting the new post then deleted the file. The API reference now also says that deleting a post, or removing an attachment in an update, deletes the file.

  **Upgrade notes**

  - No database migrations.
  - A script or agent that reuses a `mediaId` from another post, to make a translation for example, gets `409`. Upload the file again and attach the new ID.

- [`cea1e0f`](https://github.com/jant-me/jant/commit/cea1e0fb537f50336b1a779447a49f2c8354ce5b) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `GET /api/media` and `jant_media_list` page with an opaque cursor, as the post and Thread lists do, and `nextCursor` is `null` on the last page. The cursor used to be the last media ID, and a full last page handed back one that led to an empty page.

  **Upgrade notes**

  - No database migrations.
  - Pass `nextCursor` back as it is. A media ID is no longer accepted as `cursor` and answers `400`.

- [`29da81d`](https://github.com/jant-me/jant/commit/29da81d1588901fb42ed4d702377857dc4bd4a37) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Media alt text is updated with `PUT /api/media/:id`, as every other resource is updated with `PUT`. `PATCH` is no longer accepted.

  **Upgrade notes**

  - No database migrations.
  - Send `PUT /api/media/:id` in place of `PATCH /api/media/:id`; the body is the same.

- [`0f15f54`](https://github.com/jant-me/jant/commit/0f15f548dcf5bd5179fe0ab71687c0c3ad55959d) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `POST /api/nav-items` checks that a collection item's `collectionId` is a collection ID, as the reference already said. A malformed ID, or the ID of something else, answers `400` rather than `404`.

  **Upgrade notes**

  - No database migrations.
  - A malformed or wrong-kind `collectionId` answers `400` where it answered `404`.

- [`8af8213`](https://github.com/jant-me/jant/commit/8af82134e1d6ebdb390bf3fd6eebe873b9a7bbe0) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A navigation item response carries every field, as directory items and custom URLs do: `systemKey`, `collectionId`, `smartCollectionId`, `postId`, and `targetTitle` are `null` where they don't apply to the item's type, instead of left out.

  **Upgrade notes**

  - No database migrations.
  - A client that tests for these fields with `"collectionId" in item` or `!== undefined` should test the value, or the item's `type`.

- [`c457c3e`](https://github.com/jant-me/jant/commit/c457c3e70e3d900a991aa352f7a5a76ab6376b79) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A post, a collection, and a smart collection each answer at one address and redirect every other way in there with a 301: the same address in different letter case, the slug once a custom URL exists, and a custom URL added after the first. The first custom URL is the address, as feeds, the sitemap, and the export already named it; the post page used to redirect a slug to the newest one instead.

  **Upgrade notes**

  - No database migrations.
  - If a post or collection has more than one custom URL, its page now lives at the oldest one, where its feed entry and sitemap entry already pointed. Delete the older custom URL to make a newer one the address.

- [`8a45bf2`](https://github.com/jant-me/jant/commit/8a45bf21f8390e6a566ce726660ab0d6c7b0b5a1) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Post and Thread lists take only the `nextCursor` they hand out. A post ID is no longer read as a cursor, and a Thread's fold carries `gap.cursor`, which lists the replies the fold hides.

  **Upgrade notes**

  - No database migrations.
  - A post ID passed as `cursor` to `GET /api/posts`, `GET /api/threads`, `GET /api/public/threads`, a Thread's posts, or the matching MCP tools now answers `400`. Pass `nextCursor` back as it is.
  - To open a fold's hidden replies, pass `fold.gap.cursor` to the Thread's posts in place of the last `leading` reply's ID.

- [`e5e4171`](https://github.com/jant-me/jant/commit/e5e417124f008cbb2dc8a119b45c5ab369f1c922) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Every API read that returns posts takes `content=markdown`, which returns `bodyMarkdown` in place of `body`, `bodyHtml`, and `bodyText`. It worked on the public API only; `GET /api/posts`, `GET /api/posts/:id`, the `/api/threads` reads, and their MCP tools now take it too. `GET /api/posts/:id/content` and `jant_posts_get_content` are removed.

  **Upgrade notes**

  - No database migrations.
  - Replace `GET /api/posts/:id/content` with `GET /api/posts/:id?content=markdown` and read `bodyMarkdown`. Replace `jant_posts_get_content` with `jant_posts_get` and `content: "markdown"`.

- [`345577a`](https://github.com/jant-me/jant/commit/345577a4757f2b2488d48648eb9cd94af017ec5e) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A post's theme hooks mark each part once. `data-post-media` wraps the attachments once; the gallery row inside it, which also carried it, has its own internal attribute. A quote's quoted text gets `data-post-quote`, so it can be styled apart from the commentary, which is `data-post-body`. The theming reference describes `data-post-meta` as the date and the collections, and `data-post-media` as every kind of attachment.

  **Upgrade notes**

  - No database migrations.
  - A rule for `[data-post-media] [data-post-media]`, or one that relied on the inner element, should target `[data-post-media]` alone. The quote example in the theming reference used `[data-format="quote"] [data-post-body]`, which styled the commentary; use `[data-post-quote]` for the quoted text.

- [`99ce2d2`](https://github.com/jant-me/jant/commit/99ce2d267735738c1d599233badb02fc56c973a0) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `@jant/core` publishes its types as `dist/index.d.ts`, instead of pointing TypeScript at its own source, and no longer asks for `hono` as a peer dependency: the Hono it runs on is bundled. `createApp()` is typed as an `App` with a single `fetch` method rather than the whole Hono application. Compatibility adds the `DB` and `R2` binding names to the project layout a release keeps.

  **Upgrade notes**

  - No database migrations.
  - A TypeScript site that called Hono methods on what `createApp()` returns, other than `fetch`, no longer type-checks. Only `fetch` was ever part of the API.

- [`89438a5`](https://github.com/jant-me/jant/commit/89438a59b441ece3955ca6809523182ab11d5b26) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A site avatar is stored as PNG, JPEG, or WebP, and its bytes must match its type. An SVG avatar used to be stored as it was and served from the site's own origin. The settings page now turns an SVG into a PNG before uploading it, as it already did for other formats.

  **Upgrade notes**

  - No database migrations.
  - `POST /api/settings/avatar` refuses an SVG, and a `file` or `appleTouch` whose contents aren't the image type it names, with `400`. An SVG avatar already stored stays as it is.

- [`5a81b39`](https://github.com/jant-me/jant/commit/5a81b3949e39c4b2e80b2702c42c10c34faeb58f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `RATE_LIMIT_ENABLED` replaces `RATE_LIMIT_DISABLED`, named and defaulting like the other `_ENABLED` switches. `false` turns off every limit: search, sign-in, and setup. `RATE_LIMIT_SEARCH_PER_MIN=0` now leaves search unlimited; it used to be read as 30.

  **Upgrade notes**

  - No database migrations.
  - Replace `RATE_LIMIT_DISABLED=true` with `RATE_LIMIT_ENABLED=false`. `RATE_LIMIT_DISABLED` is no longer read, so the limits apply until you do.

- [`c61ded9`](https://github.com/jant-me/jant/commit/c61ded9fb7e6f38dd5e0d3ea96297678e4d774bb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A signed-in browser's session can no longer be used by another site's page. A request that changes something and carries the session cookie must come from the site itself, or from an origin `CORS_ORIGINS` names; otherwise it gets `403`. Blogs that share a parent domain, such as hosted blogs, were exposed: a page on one could save Code Injection on another whose author was signed in. On a demo site, Code Injection and custom CSS are now locked, since everyone signs in with the same account.

  **Upgrade notes**

  - No database migrations.
  - API tokens aren't affected. A browser extension that calls the API with the session cookie needs its origin in `CORS_ORIGINS`.

- [`790c1d3`](https://github.com/jant-me/jant/commit/790c1d3f9b8c2c6fc39dc855ed2e87dcecfe3973) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `GET /api/settings` reports every setting the API can change, and `PUT /api/settings` writes the appearance settings: `THEME`, `FONT_THEME`, `THEME_MODE`, `CUSTOM_CSS`, and `SHOW_HEADER_AVATAR`, each checked as its settings screen checks it. `GET` also reports `MULTILINGUAL_ENABLED` and `ADDITIONAL_LANGUAGES`. `PUT /api/settings/import` now restores only those two languages, and answers as `PUT /api/settings` does. `jant_settings_get` and `jant_settings_update` follow the same rules, and now report values set by environment variables, as the HTTP endpoints do.

  **Upgrade notes**

  - No database migrations.
  - Send appearance settings to `PUT /api/settings`. `PUT /api/settings/import` lists them in `rejectedKeys`, and answers `400` when a request has no language key.
  - A theme or font theme ID Jant doesn't have now answers `400`; `THEME_MODE` takes `auto`, `light`, or `dark`, and `SHOW_HEADER_AVATAR` takes `"true"` or `"false"`. `PUT /api/settings/import` stored any value.
  - `PUT /api/settings/import` answers `{ settings, rejectedKeys }` in place of `{ success, rejectedKeys }`.
  - `jant site import` restores appearance in a request of its own: an export whose theme this Jant no longer has keeps the target site's appearance and prints a warning, where the import used to stop.

- [`669e69d`](https://github.com/jant-me/jant/commit/669e69d86e66b97d53c2dcb5f4d63b6dd4244c6a) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `DELETE /api/settings/:key` answers with what `GET /api/settings` returns, the reset setting's fallback included. It also returned `setting`, the settings screen's own state for the row (`mode`, `display`, `locked`, `settingsPath`), which no longer travels in the API. The compose shortcut discovery endpoint leaves the API reference: it records a hint the editor shows once, and isn't meant for clients.

  **Upgrade notes**

  - No database migrations.
  - Read the reset value from `settings[key]`.

- [`92bca06`](https://github.com/jant-me/jant/commit/92bca06da90d7a40ec70edf3070f4d307967daac) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant site import` and `jant site pull-media` read `jant-site-export.zip` by default, the file `jant site export` writes, so the three commands chain without `--path`. `site import` used to read the current directory. `site pull-media` takes `-o` for `--output`, as `site export` does.

  **Upgrade notes**

  - No database migrations.
  - A `jant site import` that relied on reading the current directory needs `--path .`.

- [`149ebae`](https://github.com/jant-me/jant/commit/149ebaeb5575867cb68009a82c8262526ea328ac) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Post fields take one type each, as the API reference documents: `pinnedAt` and `featuredAt` are Unix seconds or `null`, `rating` is a number, `pinned` is a boolean, and `collectionIds` is an array. The API used to also accept ISO 8601 strings for the timestamps, `"3"` for a rating, `"on"` for `pinned`, and `""` for `collectionIds`, left over from HTML forms.

  **Upgrade notes**

  - No database migrations.
  - Send `pinnedAt` and `featuredAt` as Unix seconds, and `rating` as a number. The other spellings answer `400`.

- [`ac8fb87`](https://github.com/jant-me/jant/commit/ac8fb8788ca1756f9281a68e1337812f16105930) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A first path segment that starts with `_` or `.` belongs to Jant: new system addresses go there, as `/_assets`, `/__sso`, and `/.well-known/` already do. A post's `path` now follows the same rule as a custom URL: it starts with a letter or digit and holds only lowercase letters, digits, `-`, `.`, and `/`. A slug derived from underscores no longer starts, ends, or doubles up on a hyphen (`_x` gave `-x`).

  **Upgrade notes**

  - No database migrations.
  - `POST /api/posts` and `jant_posts_create` answer `400` for a `path` outside that rule, such as `_notes/plan`, `~me`, or one with non-ASCII letters. Uppercase letters and extra slashes are still folded away.
  - A post address created earlier under a first segment that starts with `_` or `.` now answers `404`, and so does the post's slug, which redirects there. Give the post a new custom URL under Settings → Custom URLs and delete the old one.

- [`bf1634a`](https://github.com/jant-me/jant/commit/bf1634ad4dcfe433ffac613b9efdf48901615f86) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The deploy workflow new projects get runs `jant deploy`. It ran `wrangler d1 migrations apply` and `wrangler deploy` itself, which skipped the data backfills `jant migrate` runs and uploaded unprefixed assets for a site under `SITE_PATH_PREFIX`, so its styles and scripts 404ed.

  **Upgrade notes**

  - No database migrations.
  - A project created before this release keeps the old workflow. In `.github/workflows/deploy.yml`, replace the "Run migrations" and "Deploy to Cloudflare Workers" steps with one step that runs `npx jant deploy` (`pnpm exec jant deploy`, or `yarn jant deploy`) with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set from the same secrets. Then run `npx jant migrate --remote` once, or push, to apply backfills the old workflow skipped.

- [`02559c8`](https://github.com/jant-me/jant/commit/02559c8df9a65385e310e5ce0006d509073a4206) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Theme color variables are named for what they color, and the theming reference lists the ones that decide how a post reads.

  - `--site-elevated-bg` is gone: it was the page color under another name, so its rules now read `--site-page-bg`.
  - `--site-nav-hover-bg` is `--site-subtle-bg`, since it also fills feed cards and code blocks.
  - `--search-mark-bg` and `--search-mark-color` are `--site-search-mark-bg` and `--site-search-mark-color`.
  - The reference now lists `--site-reading-body` (post body text, which built-in themes set, so `--foreground` alone doesn't reach it), `--site-reading-caption`, the `--site-content-link` variables that color links, the footnote rail's `--site-footnote-text` and `--site-footnote-marker`, and `--type-body-size`. It no longer says `--site-accent` colors links.

  **Upgrade notes**

  - No database migrations.
  - In custom CSS, rename `--site-elevated-bg` to `--site-page-bg`, `--site-nav-hover-bg` to `--site-subtle-bg`, and `--search-mark-*` to `--site-search-mark-*`. To recolor links, set `--site-content-link`.

- [`5cf28ef`](https://github.com/jant-me/jant/commit/5cf28efe66d763581599a7520dd3743701ef66c3) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The API ignores a request field or query parameter it doesn't know, on every endpoint. Post bodies and attachments, and the Thread lists' query parameters, used to answer `400` for one; other endpoints already ignored them. A value it can't read, in a field it knows, still answers `400`. MCP tools ignore unknown parameters the same way, and Compatibility now promises both. The one exception is a smart collection's `selection`, which answers `400` for an unknown condition, since dropping it would widen the collection.

  **Upgrade notes**

  - No database migrations.
  - A misspelled field or parameter no longer answers `400`; it has no effect. Check what a response returns rather than relying on an error.

- [`72579e0`](https://github.com/jant-me/jant/commit/72579e0052c4d625cdc95d608b1e91dd74f96b97) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A request whose path ends in `/` other than a read gets `308` to the path without it, not `301`. After a `301`, `fetch`, `curl -L`, and most HTTP libraries resend a `POST` as a `GET`, so `POST /api/posts/` answered `200` with the post list and created nothing. `308` keeps the method and body. `GET` and `HEAD` still get `301`.

  **Upgrade notes**

  - No database migrations.

- [`26f96a4`](https://github.com/jant-me/jant/commit/26f96a41b58a556378442489b46d17dd88a9fa61) Thanks [@theowenyoung](https://github.com/theowenyoung)! - On a site with `SITE_PATH_PREFIX`, the relay URLs `POST /api/uploads/init` returns start with the prefix, like every other URL the API returns. Clients had to add it themselves.

  **Upgrade notes**

  - No database migrations.
  - A client that added the prefix to `transport.url` itself sends to it as given now.

- [`ede7734`](https://github.com/jant-me/jant/commit/ede7734b827577c3fbfb6aada2a671948bca3b9e) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `PUT /api/posts/:id` and `jant_posts_update` check the fields they get against the post's format, as create does: `sourceName` on a note answers `400` instead of replacing the note's title. The update schema no longer lists `path`, `replyToId`, `quietReply`, and `translationOfId`, which it accepted and never applied.

  **Upgrade notes**

  - No database migrations.
  - An update that sends a field its post's format doesn't take, such as `url` on a note or `title` on a quote, answers `400`.
  - `path`, `replyToId`, `quietReply`, and `translationOfId` in an update are ignored, as before; they are no longer documented as accepted.

- [`743e5df`](https://github.com/jant-me/jant/commit/743e5dfac8d172d424bf1c6be611d75ead4f3c73) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `POST /api/upload` and `POST /api/uploads/:id/complete` answer `201` with the media object, the shape `GET /api/media/:id` and the MCP upload tool return. They answered `200` with their own shape, whose `filename` was the stored name rather than the name the file was uploaded under.

  **Upgrade notes**

  - No database migrations.
  - Read `originalName` for the uploaded name, and `mediaKind`, `width`, `height`, and the other media fields from the same response. `filename` is gone.
  - Both endpoints answer `201` instead of `200`.

- [`1ebea8a`](https://github.com/jant-me/jant/commit/1ebea8af648d2978eed52506d6093f9cf8b30f3c) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant uploads cleanup` runs batch after batch until nothing is left, as `search reindex` and `posts rebuild-html` do; `--once` runs a single batch. It used to run one batch of 20 and stop. `--limit` now tops out at 200, the largest batch the server runs, and the help says the command also purges deleted media past the recycle window.

  **Upgrade notes**

  - No database migrations.
  - A scheduled `jant uploads cleanup` now finishes the backlog in one run. Add `--once` to keep one batch per run.

- [`b051ee0`](https://github.com/jant-me/jant/commit/b051ee048e6310ad800aa4e92e3b12b821b07932) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A `year` condition reads the calendar in the site's time zone (`TIME_ZONE`) everywhere: the archive's `?year=` and its year picker, the archive grid's month headers, archive feeds, smart collections, and `GET /api/threads` and `GET /api/public/threads`. The year filter and the year picker used to read UTC while the grid grouped months by the site's time zone, so on a site ahead of or behind UTC a post from the first or last hours of a year appeared under the wrong year.

  **Upgrade notes**

  - No database migrations.
  - On a site whose time zone isn't UTC, posts published within the UTC offset of New Year move to the year the site's calendar gives them. A smart collection with a year condition gains or loses those posts.

### Patch Changes

- [`d3bfba1`](https://github.com/jant-me/jant/commit/d3bfba109f23bca847c2a7416a255cbd6d2de057) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The API reference matches the API again. The surface table lists smart collections and Discover; `GET /api/collections` documents `lang`; the translation candidates document their `candidates` wrapper; custom URL paths are documented with the leading slash they carry; the MCP protocol header is documented as optional; examples show `sortOrder`, `durationSeconds`, and a `null` media `nextCursor`; and the author post endpoints no longer sit under the Public posts heading. A test now holds every JSON example to its field table.

  **Upgrade notes**

  - No database migrations.

- [`3862dd3`](https://github.com/jant-me/jant/commit/3862dd3db12dfb0a4dcdcf0f920f800960f74208) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The archive's year picker offers a signed-out reader only the years that have posts they can see. A year with only private posts used to appear.

  **Upgrade notes**

  - No database migrations.

- [`fda6c97`](https://github.com/jant-me/jant/commit/fda6c973ad0b239fc4018a2fdef81bf4965078ac) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The Docker image carries uuid 11.1.1 or later, past the advisory an image scanner reports against the uuid 10 that typeid-js asks for. Jant never called the affected functions. A site installed from npm resolves uuid itself and is unchanged.

  **Upgrade notes**

  - No database migrations.

- [`9ee3e3e`](https://github.com/jant-me/jant/commit/9ee3e3ee94f5fc37c3b95a6ab2945d3de1c719bd) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Jant depends on better-auth 1.7.6, up from 1.6.27, and takes its patch releases (`~1.7.6`). Sign-in, sessions and the account tables are unchanged: 1.7.3 dropped the `issuer` column that 1.7.0 through 1.7.2 required.

  **Upgrade notes**

  - No database migrations.

- [`220efe8`](https://github.com/jant-me/jant/commit/220efe8c51b615b5619ac8465cc7c6b3f58e36a1) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Clearing an image's alt text while editing a post now takes effect on save. The editor left an empty alt text out of the save, and an attachment sent without `alt` keeps what it had, so the old text stayed on the post.

  Cleared alt text is stored as none, the same as a file uploaded without any: `PUT /api/media/:id` and a post's `attachments` with an empty `alt` now answer `alt: null`, where they answered `""`.

  **Upgrade notes**

  - No database migrations.

- [`2b833a8`](https://github.com/jant-me/jant/commit/2b833a8ca7ff47aea762a4fbbd1084845f174e7d) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant start` closes the server and the database when it gets `SIGTERM` or `SIGINT`. It used to ignore both: Docker stops a container with `SIGTERM`, and as PID 1 the process kept running until Docker killed it ten seconds later, with SQLite's latest writes still in `jant.sqlite-wal`. A backup that copied `jant.sqlite` after `docker compose down`, as the backup guide said to, missed them. Closing the database now writes them into `jant.sqlite`. Requests still running get five seconds before their connections are cut.

  The backup guide archives every `jant.sqlite*` file, and deletes them all before a restore: a `jant.sqlite-wal` left from before would be applied to the restored database and corrupt it.

  **Upgrade notes**

  - No database migrations.
  - If you back up a SQLite site by copying `jant.sqlite`, copy `jant.sqlite-wal` too when it's there, and delete both before restoring. See the backup guide.

- [`f960eff`](https://github.com/jant-me/jant/commit/f960eff66154b19aa4c693ee2ffef3ad5a1aa43a) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The configuration reference is checked in both languages against every variable the code reads, the settings the Settings pages edit, and the four defaults the compatibility promise freezes. `Bindings` now declares the variables it was missing: `DEFAULT_FONT_THEME`, `ASSET_BASE_URL`, the `GITHUB_APP_*` variables, and the rate limit variables.

  **Upgrade notes**

  - No database migrations.

- [`83f3530`](https://github.com/jant-me/jant/commit/83f353009d1fb93d8acfe005bfaeae986eca81fd) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Configuration reference fix: `DATA_DIR` defaults to the directory of a SQLite `DATABASE_URL` when one is set, not always `./data`. `DISCOVER` is documented with the values it takes, `latest` and `off`.

  **Upgrade notes**

  - No database migrations.

- [`0c88c9f`](https://github.com/jant-me/jant/commit/0c88c9f01edf9a04a4042a96cc1bf6d216362289) Thanks [@theowenyoung](https://github.com/theowenyoung)! - On the Featured page, an "N hidden posts" link opens the first post it hides, as the homepage's "N more posts" link and the feed's gap do. It opened the post just below it, which is already on screen. In the Hugo export, the Featured page's gap links opened the Thread's root; they now open the first hidden post too.

  **Upgrade notes**

  - No database migrations.
  - The Hugo `featured-thread.html` partial links each gap to the first post it hides. A copy of the partial in your own theme keeps linking to the root until you update it.
  - `TimelineItemView["curatedThread"]["segments"]` entries have a `gapHref`, `null` when nothing is hidden.

- [`5773cb2`](https://github.com/jant-me/jant/commit/5773cb2f108f01ee075daabb70ce59e1088261dd) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The backup guide's Cloudflare recovery steps work as written. They loaded a `db export` file back with `wrangler d1 execute`, but the file holds rows, not tables: loaded into the site's database it stops on a duplicate key, and into a new one on a missing table. The guide now starts with D1 time travel, and for a SQL file creates a new database, runs `jant migrate --remote` on it, loads the file, and deploys.

  **Upgrade notes**

  - No database migrations.

- [`1a356f4`](https://github.com/jant-me/jant/commit/1a356f4f52e7e09d29dc877eaac1ebfc672cc5bb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Compatibility adds the files the data directory holds, `jant.sqlite` and `media/`, to what changes only in a major release: the backup guide has you copy them directly.

  **Upgrade notes**

  - No database migrations.

- [`f359c7f`](https://github.com/jant-me/jant/commit/f359c7f6e173553cd7d2583c612c10d7dfc09c85) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The dashboard, sign-in and setup pages run Datastar 1.0.4, up from the 1.0.0-RC.7 release candidate.

  **Upgrade notes**

  - No database migrations.

- [`93256e3`](https://github.com/jant-me/jant/commit/93256e373d1e8c3f75c9e437a0df6e46dba85d54) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant db export` works on Cloudflare D1 again. It listed D1's own `_cf_KV` table (`_cf_METADATA` in local D1), which D1 refuses to read, so the export stopped with `not authorized: SQLITE_AUTH` before writing anything. The backup guide's `npx jant db export --remote` failed on every D1 site. The export now leaves D1's tables out.

  **Upgrade notes**

  - No database migrations.
  - If your D1 backups rely on `jant db export --remote`, check that recent runs produced a file: before this release they all failed.

- [`e8f1715`](https://github.com/jant-me/jant/commit/e8f1715eddaf97d0f24ac34a858bafa6e95451e7) Thanks [@theowenyoung](https://github.com/theowenyoung)! - On a demo site, saving custom CSS or code injection, changing the password, revoking a session, or deleting the account now shows why it was refused, such as "Custom CSS is off in demo mode. Every visitor shares the demo site." The refusal used to be silent: the form did nothing.

  **Upgrade notes**

  - No database migrations.

- [`fe0560f`](https://github.com/jant-me/jant/commit/fe0560f60662530bb38cd9404b3fea05129e6e3d) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The deploy workflow new projects get deploys again. Its "Check deploy prerequisites" step read `database_id` from `wrangler.toml` with a sed pattern escaped twice, so it never found the ID: every push skipped the deploy with "Replace the placeholder D1 `database_id`" in the run summary, and the run still showed as passed. Projects created since March 2026 have this workflow, so a site that relied on it has kept the version it was first deployed with.

  **Upgrade notes**

  - No database migrations.
  - In a project created before this release, fix the line in `.github/workflows/deploy.yml` that sets `database_id`: its sed pattern should read `'s/^database_id = "\([^"]*\)".*/\1/p'`, with one backslash before each parenthesis and before the `1`. Or copy the file from a new project made with the same package manager. Then push, or run the workflow by hand, to deploy the current version.

- [`3ea4fd2`](https://github.com/jant-me/jant/commit/3ea4fd29439b6f83b430fee443ebe74e08a4463c) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `DEV_API_TOKEN` works only for a request that comes from the machine Jant runs on. It used to be enough for the request to name a local host, and the `Host` header is the client's to write, so on a Node server reachable from outside, anyone who knew the token could use it.

  **Upgrade notes**

  - No database migrations.
  - `DEV_API_TOKEN` is a local debugging aid. Remove it from production configuration.

- [`44e9da1`](https://github.com/jant-me/jant/commit/44e9da14476c405b2dfa383ff74daffc7c313497) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The Docker image no longer gives its app user `/usr/local/bin`, where the `node` binary lives. The Docker guides say the Compose file, not the image, applies migrations, show the migrate step before `docker run`, hand `./data` to the container's user on Linux, back up before an update, and stop using the placeholder `AUTH_SECRET` the startup check refuses.

  **Upgrade notes**

  - No database migrations.
  - If you run the image with `docker run` rather than the Compose file, run `jant migrate` in it after each image update; the app refuses to start on a database that isn't migrated.

- [`babe8b8`](https://github.com/jant-me/jant/commit/babe8b8fe8e7b2c513ddda78d2bc8b1bbd26c94f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `compose.yml` and the Docker guides run `jant migrate` and `jant setup`, the command the image puts on the path, instead of `node bin/jant.js`, which named a file inside the image.

  **Upgrade notes**

  - No database migrations.
  - A `compose.yml` you copied earlier keeps working. To match the current one, change the `jant-migrate` service's command to `["jant", "migrate"]`.

- [`e1645a7`](https://github.com/jant-me/jant/commit/e1645a71725b727f0a247975f40f6389535503cb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The Docker guide creates the admin account from the command line with `docker compose run --rm -T jant jant setup`. Its `docker run` example mounted the data directory but left out `.env`, so on a site configured for Postgres the account went into an SQLite file nobody reads, and the site stayed on its setup page. `docker compose run` gives the command the site's own settings and runs the migrations first.

  **Upgrade notes**

  - No database migrations.

- [`7d24448`](https://github.com/jant-me/jant/commit/7d24448f51a8dfda8ed47c0ba0d2a33b99720c12) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `@jant/core` no longer lists `marked` as a dependency of its own. Nothing imported it directly; the editor's Markdown support installs the version it needs.

  **Upgrade notes**

  - No database migrations.

- [`c3d53b9`](https://github.com/jant-me/jant/commit/c3d53b9ffba8c6fdd4c2245566fbe52d47dd1051) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `@jant/core` no longer asks for `tailwindcss` as a peer dependency. Its stylesheets ship built, so a site never needed it installed.

  **Upgrade notes**

  - No database migrations.
  - You can remove `tailwindcss` from a site's dependencies if nothing else in the project uses it.

- [`af7c062`](https://github.com/jant-me/jant/commit/af7c06244b2b7ca89bbf2497db53087a067ee267) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The API reference, the feed handout, and Compatibility say that a field with a fixed set of values, such as a post's `format` or an error's `code`, can gain a value in a minor release: read an unknown `format` as `note`, and handle an unknown `code` by the HTTP status.

  **Upgrade notes**

  - No database migrations.

- [`ae86a9c`](https://github.com/jant-me/jant/commit/ae86a9c46ded1c33f1b6cb95e19e7d3de11c0854) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Compatibility and the API reference say an error's `details`, apart from the settings endpoint's `rejectedKeys`, and the wording of its `error` message can change in any release. Branch on `code`.

  **Upgrade notes**

  - No database migrations.

- [`5f69d72`](https://github.com/jant-me/jant/commit/5f69d7224f9afae98d642e12a18924da1c36deec) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A site export and GitHub Sync include every post. They read at most 10,000 posts, replies included, and silently left out the rest of a larger site.

  **Upgrade notes**

  - No database migrations.

- [`0a70940`](https://github.com/jant-me/jant/commit/0a70940aec4279ca2d6f219acb219f6507cb2da0) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant site export` downloads the files of the site it exports even when that site is on a private address, such as `--url http://127.0.0.1:3000` on the machine that runs it. The check that keeps an export from fetching private addresses refused the site's own files too, so an export of a site on this machine kept the avatar as a link to `127.0.0.1`, and the import that read it couldn't bring the avatar along. Other private addresses are still refused, and `jant site pull-media`, which reads its addresses from the export file, refuses them all.

  **Upgrade notes**

  - No database migrations.

- [`644a313`](https://github.com/jant-me/jant/commit/644a313f0c91a529ccfb4092c44cd6be510f9c67) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The FAQ no longer says comments may come later: Jant has no built-in comments, and a third-party system such as giscus or Disqus goes in through code injection.

  **Upgrade notes**

  - No database migrations.

- [`a9e7a80`](https://github.com/jant-me/jant/commit/a9e7a807db74e356f2a62c64ffc4cef022966385) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Feed entries now carry the `<category>` that [Reading a Jant feed](https://jant.me/docs/feed-reading) describes, one for each Collection the entry's Thread is in. The renderer wrote them, but no feed passed it the Collections, so no feed ever had one. Each category's `jant:page` is the address the Collection's page answers at: its first custom URL when it has one, otherwise its slug.

  **Upgrade notes**

  - No database migrations.

- [`6ffaa03`](https://github.com/jant-me/jant/commit/6ffaa030ad3a2c3dfef50d2112c39c8d43da533a) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The feed references list every change that moves an entry's `<id>`, the post's address: a new slug, a first custom URL added or removed, a new domain, and a new `SITE_PATH_PREFIX`. They named only the slug and the domain. `<jant:id>` stays the same through all of them.

  **Upgrade notes**

  - No database migrations.

- [`a351863`](https://github.com/jant-me/jant/commit/a351863dbc5fb0676d47a1907430124c5f173b5e) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A feed's display text, such as "▶ Watch video" and "2 more posts", comes from the same translations as the site's reader pages, so the feed and the page beside it say the same thing. The feed reference now calls it display text that can change, and points a consumer at `hidden` on `<jant:thread>` to write its own.

  **Upgrade notes**

  - No database migrations.
  - A consumer that matched the English text of these labels should read `hidden` and the media attributes instead.

- [`ad584fb`](https://github.com/jant-me/jant/commit/ad584fbd48e37c1ef3df81fbd1dca959318a9b55) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The feed reference says what an entry's dates mean: `<published>` is always the post's own publication date, in every feed; `<updated>` moves with edits, replies, and, in a collection's feed, the collection taking the post in. It also documents the feed-level elements, such as `title`, `author`, `id`, `updated`, and the `hreflang` alternates, which only the internal notes described.

  **Upgrade notes**

  - No database migrations.

- [`e757309`](https://github.com/jant-me/jant/commit/e75730932334b739f0003d0688fd3615b16a2d17) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The feed reference lists the older addresses that still redirect. It said every `/{page}/feed/atom.xml` did; only the latest, featured, and archive feeds' do, and the `/feed/*/atom.xml` forms were missing.

  **Upgrade notes**

  - No database migrations.

- [`6b8afd8`](https://github.com/jant-me/jant/commit/6b8afd891e82c239e0ed7bee10a1f62631ba67fc) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A reply has the same address in every feed. The archive, collection, and smart collection feeds named a reply by its slug where the latest and featured feeds used its custom URL, so a reader following two feeds could see one reply as two posts.

  **Upgrade notes**

  - No database migrations.

- [`ece0de6`](https://github.com/jant-me/jant/commit/ece0de6ae7f16194ebdc6000d51c3c7399068d64) Thanks [@theowenyoung](https://github.com/theowenyoung)! - With `RSS_FEEDS_ENABLED=false`, only feed routes answer 404. Every address ending in `/feed` used to, so a post or collection with a custom URL such as `notes/feed` became unreachable.

  **Upgrade notes**

  - No database migrations.

- [`7534349`](https://github.com/jant-me/jant/commit/753434936606aea473ff84e4b1b0f918e9495767) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A font set in custom CSS on `:root`, such as `--font-body`, now applies in dark mode as well. The font theme's variables were also written into the dark-mode blocks, which outrank `:root`, so the font theme won whenever the page was dark.

  **Upgrade notes**

  - No database migrations.

- [`8f218bf`](https://github.com/jant-me/jant/commit/8f218bf1c5cf5dabf8c2ca4c1a6b1452fc13dbdc) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The FAQ says how to get back into a self-hosted site after forgetting the password: `jant reset-password`, with `--remote` on Cloudflare or through `docker compose exec` on Docker, then the printed `/reset` link on the site. New projects' README runs the reset against the deployed site; `npm run reset-password` alone resets the local development database.

  **Upgrade notes**

  - No database migrations.

- [`75c8dcd`](https://github.com/jant-me/jant/commit/75c8dcd6e62b309ff31f3f588b0bc15da6e26a2f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The README and overview no longer call the GitHub Sync repository a full backup. It holds the site's writing, and media files stay in the site's storage, so someone relying on it alone would lose every image and attachment with the storage. Both now say so and link the backup guide.

  **Upgrade notes**

  - No database migrations.

- [`03edb5c`](https://github.com/jant-me/jant/commit/03edb5ca82eb04762eb69b931de75ddc62564d65) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The API reference documents the two addresses GitHub calls, `/api/github-sync/webhook` and `/api/github-sync/app-webhook`, with the secret each checks. Both live in GitHub's settings, so they change only in a major release.

  **Upgrade notes**

  - No database migrations.

- [`a60b06c`](https://github.com/jant-me/jant/commit/a60b06c97de9834c11984c2a162374a8365e23c8) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The Node server runs on `@hono/node-server` 2, up from 1, which reads request bodies faster.

  **Upgrade notes**

  - No database migrations.

- [`96e40ec`](https://github.com/jant-me/jant/commit/96e40ecc3209030b2a95c36a1aaf0fc9fd458927) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Compatibility, Configuration, and Command line say which surfaces serve only the hosted service or local debugging and can change in any release: `SITE_RESOLUTION_MODE`, the `HOSTED_CONTROL_PLANE_*` variables, `DEV_API_TOKEN`, the `DEMO_*` variables, `--site`, `--host`, and `--path-prefix` when they pick a site from a shared database, and `/api/palette`.

  **Upgrade notes**

  - No database migrations.

- [`368c22f`](https://github.com/jant-me/jant/commit/368c22f607eae26e7794380dc95f5e2b178de2f3) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Opening a hosted site from the provider now records the browser on the session, so the Sessions page names the device instead of showing "Unknown device". Opening it again in a browser that is already signed in as the same person keeps that session rather than adding another. Sessions made before this release keep showing as unknown until they expire or are revoked; the one in the browser you open the site from next gets its device filled in.

  **Upgrade notes**

  - No database migrations.

- [`f8ef1d1`](https://github.com/jant-me/jant/commit/f8ef1d1348482fd37f4746828417f0b41077e0a7) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant site import` takes the site's name, description, language, theme, and display flags from `data/jant.toml`, and falls back to `hugo.toml` only for exports that don't have the value there. It read `hugo.toml` first, so a `hugo.toml` edited to build the static site changed what an import restored.

  **Upgrade notes**

  - No database migrations.

- [`6e257bc`](https://github.com/jant-me/jant/commit/6e257bc0e14cff8d367709beb8b7cee7c6cff75e) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant site import` no longer stops when it can't recreate one of a post's old addresses. An export from an earlier release can list aliases this release refuses, such as `/~me`, and the import exited there with the site half imported. It now warns, names the address, and goes on, as it already did for a Collection's; the summary counts the aliases it skipped.

  **Upgrade notes**

  - No database migrations.

- [`2e7522a`](https://github.com/jant-me/jant/commit/2e7522ad61161a69cfebcc45d478b2b67c222414) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Removing an attachment while editing a post no longer deletes it at once. The editor used to delete the file as soon as it was removed, so discarding the edit left the post without it. Saving the edit deletes it, the post's last attachment included; discarding the edit keeps it. A file uploaded during the edit and removed again is still deleted at once.

  An edit that was interrupted, by a closed tab or a failed save, now comes back with the post's attachments. It used to come back without them, and saving it could delete them.

  **Upgrade notes**

  - No database migrations.

- [`c8fb66e`](https://github.com/jant-me/jant/commit/c8fb66efede8a05b9f62778298893b394680afbc) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Redirects stay on the site. An address such as `//example.com/` was redirected to `//example.com`, which a browser follows to another host, and the `301` is cached for good; it now redirects to `/example.com`. The hosted and local sign-in links also refuse a `redirect` target that starts with `/\`.

  **Upgrade notes**

  - No database migrations.

- [`2adf743`](https://github.com/jant-me/jant/commit/2adf743b1f35166cfcc51fd5a4f031e643e1c206) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Every old feed address carries its query string to the feed it redirects to. `/feed/latest/atom.xml`, `/feed/all/atom.xml`, `/feed/featured`, `/feed/featured/atom.xml`, and `/feed/atom.xml` dropped it, so a subscription to `/feed/latest/atom.xml?format=note` got every format.

  **Upgrade notes**

  - No database migrations.

- [`822eaa4`](https://github.com/jant-me/jant/commit/822eaa48764f2faa345a72cf93e2af8f192f1c61) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Jant's translations run on Lingui 6, up from 5, and `@jant/core` no longer depends on `@lingui/react`, which nothing imported. Every page reads the same as before.

  **Upgrade notes**

  - No database migrations.

- [`f8152c8`](https://github.com/jant-me/jant/commit/f8152c84d8f34972e2f6bd4d73fe237f69b5b261) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant_posts_delete` lists only `id` as its parameter. It borrowed `jant_posts_get`'s schema and advertised a `content` parameter it never read.

  **Upgrade notes**

  - No database migrations.

- [`d2e5c62`](https://github.com/jant-me/jant/commit/d2e5c629e99d4977bdaebe65bded55d2106e969f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Compatibility and the API reference say how MCP protocol versions change: a minor release can accept a newer one, and only a major release drops one.

  **Upgrade notes**

  - No database migrations.

- [`f7c4968`](https://github.com/jant-me/jant/commit/f7c496812b0c6e17685043e0c5f26272677f41d8) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Jant depends on nanoid 6, up from 5. Random slugs look the same.

  **Upgrade notes**

  - No database migrations.

- [`159fc3f`](https://github.com/jant-me/jant/commit/159fc3fe7645b765fac406f044e0d753894fe614) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A Collection link in the header is marked as recently active only for activity the reader can see. A draft, or a post in a private Thread, used to set the marker, and its time, for every visitor.

  **Upgrade notes**

  - No database migrations.

- [`3e3044f`](https://github.com/jant-me/jant/commit/3e3044f7c22a32357cf9b57bde8560dfb9af1886) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Closing a draft opened from Drafts no longer offers to delete it. Opening one just to read it and pressing Escape asked "Save to drafts?", and its "Don't save" deleted the draft and its files. Now a draft with no changes closes without asking, and "Don't save" only drops the changes made since it opened. Delete a draft from the Drafts list.

  **Upgrade notes**

  - No database migrations.

- [`2af92ea`](https://github.com/jant-me/jant/commit/2af92eaaba9b3751812977c4cd4140350e48c337) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Pasting or dropping content into the editor no longer brings in an HTML block. A page you copy from could plant one, in its HTML or as a `jant-html` fence in the Markdown it puts on the clipboard, and it would publish its HTML as it was, scripts included. A pasted HTML block now arrives as an `html` code block with its source intact, and a pasted embed keeps only its URL. Insert an HTML block from the editor's menu to add one on purpose.

  **Upgrade notes**

  - No database migrations.
  - Posts already saved are unchanged.

- [`902482c`](https://github.com/jant-me/jant/commit/902482c34a87de7f1759c2548c9b0796e6dec095) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A post's `permalink` in `GET /api/public/posts/:slug`, `GET /api/public/threads` (the post objects and a fold's `gap`), `GET /api/search`, and `jant_posts_search` is its first custom URL when it has one, the address its page and its feed entry's `<id>` use. It was always `/{slug}`, which only redirects there.

  **Upgrade notes**

  - No database migrations.

- [`7662a06`](https://github.com/jant-me/jant/commit/7662a065f1fceeed52f54c8a31ea4a754aed519d) Thanks [@theowenyoung](https://github.com/theowenyoung)! - On Postgres, a search made only of punctuation, such as `'''`, no longer fails. The `/search` page showed "search failed" and `/api/search` answered 500. It now runs the same substring search a query too short for full-text search does.

  **Upgrade notes**

  - No database migrations.

- [`6e1aed6`](https://github.com/jant-me/jant/commit/6e1aed612d5217d304968525577ec246c23e08da) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A snapshot taken from a Postgres database restores into one. `jant site snapshot import` sent SQLite's `PRAGMA` to Postgres, and the export wrote booleans as `1` and `0`, which Postgres refuses for a boolean column, so every Postgres restore failed. `jant db export` on Postgres writes the same literals Postgres reads, timestamps included.

  **Upgrade notes**

  - No database migrations.
  - A snapshot exported from Postgres before this release can't be restored, since its `db.sql` has `1` and `0` in boolean columns. Export a new one.

- [`5bcd4ec`](https://github.com/jant-me/jant/commit/5bcd4ec24002fed2456cc89bc3e778593c5b65b0) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `jant posts rebuild-html --site` takes the site's key or ID, as the database commands' `--site` does. It took only the ID.

  **Upgrade notes**

  - No database migrations.

- [`7c7ae3a`](https://github.com/jant-me/jant/commit/7c7ae3a440d3ab1d6d141a271d678f7579a506eb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A redirect to a post's or Collection's one address keeps the query string. `/more-notes?sort=oldest` used to redirect to `/notes`, dropping the sort and the page a reader had saved with the link. A custom URL that redirects to a path on the site without a query string of its own now passes the reader's along too; one with its own query string, or one to another site, goes where it says.

  **Upgrade notes**

  - No database migrations.

- [`33db0a9`](https://github.com/jant-me/jant/commit/33db0a96c5bd71d7a9761c6afdf0eb9fe8cee2b6) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The reserved paths reference says what is reserved: an address whose first segment is one of the names, in any letter case, and each additional language's prefix while multilingual content is on. The writing guide links to that list instead of keeping an older copy.

  **Upgrade notes**

  - No database migrations.

- [`4d0ea8a`](https://github.com/jant-me/jant/commit/4d0ea8ab749308efefe0ff506b72ac41c358b1fb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A password reset link resets the site owner's password. It used to reset the first account in the database, which on a server hosting several sites could belong to another site. On such a server, deleting a site from its own settings is refused, since it would have emptied every site's tables; the hosted control panel deletes sites.

  **Upgrade notes**

  - No database migrations.

- [`107e394`](https://github.com/jant-me/jant/commit/107e394ab5c6ca2c76104e532cf9d6491903d127) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A stored file opened on its own can no longer run scripts on the site. Every file under `/media/` is served with `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`, PDFs aside, so an HTML or SVG file opens without the site's session or scripts. Files sent to the Telegram bot now follow the browser upload rules: an image, video, audio file, or PDF shown inline must really be that format, and any other file is stored as a download. It used to keep whatever type the sender's app claimed and open inline.

  **Upgrade notes**

  - No database migrations.
  - Images, video, and audio in posts display as before. Only opening a stored file directly is affected.

- [`25079c7`](https://github.com/jant-me/jant/commit/25079c78e8f93652e701557e393dc18674f83d5c) Thanks [@theowenyoung](https://github.com/theowenyoung)! - `SITE_LANGUAGE` and `TIME_ZONE` set in the environment now reach a new site. Setup offers `SITE_LANGUAGE` as the site's language, and leaves the time zone to `TIME_ZONE` instead of storing the browser's. Before, setup always stored both, which outranked the environment for good.

  **Upgrade notes**

  - No database migrations.
  - A site set up before this keeps the language and time zone setup stored. Change them in Settings, or reset them in the Config Editor to follow the environment.

- [`58ea45f`](https://github.com/jant-me/jant/commit/58ea45f83b46145dfe99b54a5799ba37559366cf) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Rehosting a pasted image refuses more private addresses. On Node, each host is resolved first and refused when any address it resolves to is private, so a name like `127.0.0.1.nip.io` no longer reaches the server's own network. Addresses written as `localhost.` or in an IPv6 form that carries an IPv4 address (IPv4-compatible, NAT64, 6to4) are refused too.

  **Upgrade notes**

  - No database migrations.

- [`ace7964`](https://github.com/jant-me/jant/commit/ace7964c0e09d6c278936c0456ff45a133c23189) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A hosted sign-in link signs in once. Opening the same link again before it expires shows the expired-link page, with the way back to the hosted account. It used to sign in every time until it expired, so a link that turned up in a log or browser history could be reused.

  **Upgrade notes**

  - No database migrations.

- [`1c527b3`](https://github.com/jant-me/jant/commit/1c527b37626ca9256c752ac513b78d82097bfe67) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The sitemap no longer lists the address of a draft or private translation. A published post's translation alternates included every version in its group, so a draft's or private post's address, usually made from its title, was public.

  **Upgrade notes**

  - No database migrations.
  - A sitemap shard that is full stays cached for up to a day, so an address already listed can take that long to drop out.

- [`f7cb560`](https://github.com/jant-me/jant/commit/f7cb56021db236a096f5e316e279df35de7b3f6f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A snapshot carries the files the avatar and the Apple touch icon settings name. It restored the settings but took the files only when a media record listed them, so on a site whose avatar predates those records, the restored avatar and icon answered `404` in the new storage.

  **Upgrade notes**

  - No database migrations.

- [`5971ee0`](https://github.com/jant-me/jant/commit/5971ee0af5c2f3f73b0696c6a1f8a1a5b123ca52) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A snapshot writes its settings so that a later Jant can restore it over any site. Each setting row replaces the target's row with the same key, so a snapshot carrying a setting the importing version doesn't know no longer fails halfway, after its files were uploaded. A snapshot in a newer format than the installed Jant reads now says to upgrade `@jant/core`.

  **Upgrade notes**

  - No database migrations.

- [`aa1ed8e`](https://github.com/jant-me/jant/commit/aa1ed8e78d32f5d8885fadd706b521d6fc8c66a7) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A hosted sign-in link for an admin or editor is refused. Jant gives every member of a site the owner's full access, so until roles take effect, only the owner signs in through the hosted account. The hosted service only creates owners today.

  **Upgrade notes**

  - No database migrations.

- [`7ffcbca`](https://github.com/jant-me/jant/commit/7ffcbca204025e3562d4a1702f1285bb30329fee) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The GitHub Sync guide says that drafts and private posts are pushed to the repository along with everything else, and to use a private repository if you have them. It used to say a public repository works just as well.

  **Upgrade notes**

  - No database migrations.

- [`b2f271d`](https://github.com/jant-me/jant/commit/b2f271da2dda424c03c3aa6bcccbc04c4b32611f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Editing a quote's `source_name` or `source_url` in a GitHub Sync repository updates the quote in Jant. The webhook passed them under names the post service ignored, so the edit was dropped.

  **Upgrade notes**

  - No database migrations.

- [`d134927`](https://github.com/jant-me/jant/commit/d134927dad2e8432477a0e3c5a8855d5f85b78db) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The API reference documents the Telegram webhook, `POST /api/telegram/webhook/:botId`, next to the GitHub webhooks: who registers it, how it checks the secret, and what it answers.

  **Upgrade notes**

  - No database migrations.

- [`dd12953`](https://github.com/jant-me/jant/commit/dd12953d366b738ca3f63ff52fdfa2ec44f83811) Thanks [@theowenyoung](https://github.com/theowenyoung)! - New projects' `wrangler.toml` sets `keep_vars = true`, so a deploy keeps the variables set in the Cloudflare dashboard. The deployment guide offers the dashboard for `R2_PUBLIC_URL` and `IMAGE_TRANSFORM_URL`, but Wrangler deletes dashboard variables the file doesn't list on every deploy, so the next push after setting them there removed them without a word: media went back through the Worker and images stopped resizing.

  **Upgrade notes**

  - No database migrations.
  - In a project created before this release, add `keep_vars = true` near the top of `wrangler.toml`, before the first `[section]`. If you set variables in the dashboard, check that they're still there, since a deploy may already have removed them, and set them again, or move them into `[vars]`.

- [`77b968e`](https://github.com/jant-me/jant/commit/77b968e656f5d8b611b1141eaa24fda9c482be5c) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The writing guide lists the address of a text attachment's own page, `/{slug}/text/{attachment-id}`, which feeds link to through `jant:page`.

  **Upgrade notes**

  - No database migrations.

- [`3b0283b`](https://github.com/jant-me/jant/commit/3b0283ba80af268d977c5a17ae501d328b632010) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The theming reference is checked more strictly: each attribute it names must appear under that exact name, the `data-format`, `data-theme-mode`, and `data-theme` values must be real ones, and a variable counts as working only if a reader's page reads it.

  **Upgrade notes**

  - No database migrations.

- [`afb2113`](https://github.com/jant-me/jant/commit/afb2113a28f3b6f157d70959c9911cef705999fc) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The theming reference says which views carry which post hooks: the feed, a post's page, and a collection carry all of them; a search result carries the `<article>` attributes only; an archive grid tile carries `data-post` and `data-format`.

  **Upgrade notes**

  - No database migrations.

- [`fa23ee8`](https://github.com/jant-me/jant/commit/fa23ee836231da5b13d97f7170d9c60780f78515) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The theming reference lists the layout variables that shape reader pages: `--layout-body-max-width` for the page frame and `--site-feed-rhythm` for the space between posts. It listed `--content-max-width`, `--site-padding`, and `--content-gap`, which reader pages don't use, so the "wider content area" example changed nothing. `--site-column-outline` and `--fw-bold`, which only the signed-in author's interface reads, are no longer listed.

  **Upgrade notes**

  - No database migrations.
  - Custom CSS that set `--content-max-width` to widen the page had no effect; set `--layout-body-max-width` instead.

- [`8a89df9`](https://github.com/jant-me/jant/commit/8a89df91687b1166699b070e38d26289c939bc0f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The theming reference lists `data-post-end`, the slot after a post where code injection mounts comments, and the `.footnote-backref` class. The link to loading custom fonts through code injection works again, and a mention of "HTML contract versions", which nothing defines, is gone.

  **Upgrade notes**

  - No database migrations.

- [`49c3898`](https://github.com/jant-me/jant/commit/49c3898329e139b9f7d30fe2761de063e6dfc7a4) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Saving a Thread draft again, or publishing it, keeps its attachments. Jant replaces the saved draft with the new version, and it used to delete the old draft's attachments, files included, before creating the new one from the same media IDs; the save then failed with `400`, and the draft and its images were gone. The attachments the new version keeps now move to it, and only the ones the author removed are deleted. When creating a Thread fails partway, the uploads its posts had attached are kept for a retry rather than deleted with them.

  **Upgrade notes**

  - No database migrations.

- [`40fbcd6`](https://github.com/jant-me/jant/commit/40fbcd659870585cb9b4c6af66d8f9b0fe3c2c69) Thanks [@theowenyoung](https://github.com/theowenyoung)! - A folded Thread's "N more posts" link on the homepage and other list pages opens the first post it hides, as the feed's gap already did. It opened the newest post, which is already on screen.

  **Upgrade notes**

  - No database migrations.

- [`3df746e`](https://github.com/jant-me/jant/commit/3df746ef3fc93de2640bafb946622d102c0df580) Thanks [@theowenyoung](https://github.com/theowenyoung)! - [Compatibility](https://jant.me/docs/compatibility) now sorts what Jant promises into three levels. In-place upgrades, exports and snapshots from 0.7.0 on, post and Collection addresses, and feed addresses and entry IDs keep working in every release, major ones included. The HTTP API, MCP tool names and parameters, the command line, configuration, feed contents, the export format, the Docker image name and data directory, `createApp`, and the project layout change only in a major release, whose upgrade notes say what to do. Theme hooks, MCP tool results, what's inside a post's `body` (read and write `bodyMarkdown` instead), TypeScript types, and the exported Hugo templates are not promised; a release that changes one says so in its notes.

  **Upgrade notes**

  - No database migrations.

- [`bc2ddde`](https://github.com/jant-me/jant/commit/bc2dddee8cbb91e178920ef5a3ab2a2e21623250) Thanks [@theowenyoung](https://github.com/theowenyoung)! - On a post whose translation has a custom path, the language switcher, the "Also available in" line and the `hreflang` alternates link that translation at its custom path. They linked `//path`, which browsers and crawlers read as the address of another host. A folded Thread's "N more posts" link had the same fault when the first hidden post had a custom path.

  **Upgrade notes**

  - No database migrations.

- [`34eb274`](https://github.com/jant-me/jant/commit/34eb2749b8f7b9ede3bbc37dfd999352c501fbcc) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The API reference says the lists that return everything in one response (collections, smart collections, navigation items, and a post's other versions) keep doing so for a request that doesn't ask for a page, even if they gain pages later.

  **Upgrade notes**

  - No database migrations.

- [`b568d8a`](https://github.com/jant-me/jant/commit/b568d8a0e317c7bac65e34b1777d948983d1f92f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - The API reference lists the image, video, and audio types uploads take: JPEG, PNG, and WebP images, MP4 video, and MP4 audio. It said "a broad set", and a script uploading a GIF, HEIC, MOV, or MP3 got `400` without knowing why. The upload examples name the file's type, since curl declares a `.webp` file as `application/octet-stream` and the upload was then stored as a download rather than an image.

  **Upgrade notes**

  - No database migrations.

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

### Minor Changes

- [`191d9da`](https://github.com/jant-me/jant/commit/191d9da71d615b591546798e76f39e806b53db9c) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix reply attachments

## 0.4.5

### Patch Changes

- [`4502502`](https://github.com/jant-me/jant/commit/4502502a0d6a1a4086bf0ccd961e598904c9a6e3) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Update desc

- [`345c597`](https://github.com/jant-me/jant/commit/345c5976fdbaccac291fc62ac72ce4546812c5cf) Thanks [@theowenyoung](https://github.com/theowenyoung)! - image width fix

## 0.4.4

### Patch Changes

- [`6d68c81`](https://github.com/jant-me/jant/commit/6d68c811db07bb851ede743896c5f5340f5b25a2) Thanks [@theowenyoung](https://github.com/theowenyoung)! - New empty homepage

## 0.4.3

### Patch Changes

- [`229a1d8`](https://github.com/jant-me/jant/commit/229a1d875e702b86b8b34b0cd2ba4abc3114a244) Thanks [@theowenyoung](https://github.com/theowenyoung)! - post actions adapt

- [`8c5f8cb`](https://github.com/jant-me/jant/commit/8c5f8cb7d76565db38521e59cc68b035f8e957f3) Thanks [@theowenyoung](https://github.com/theowenyoung)! - thread post distance

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

### Patch Changes

- [`48bfaf4`](https://github.com/jant-me/jant/commit/48bfaf42aeca810c41a63b2573317ebc6688a1da) Thanks [@theowenyoung](https://github.com/theowenyoung)! - new api

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

### Patch Changes

- [`42349f5`](https://github.com/jant-me/jant/commit/42349f5030159f448cc54026b44a657342efb02a) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Change UI

## 0.3.32

### Patch Changes

- [`e229bf0`](https://github.com/jant-me/jant/commit/e229bf0dcf81cb8b16c4d85ea2896e5f3d747f3c) Thanks [@theowenyoung](https://github.com/theowenyoung)! - echo yes

## 0.3.31

### Patch Changes

- [`e6b6fd5`](https://github.com/jant-me/jant/commit/e6b6fd5b480e970d84f93019bdc9076a195cd1d8) Thanks [@theowenyoung](https://github.com/theowenyoung)! - readme

## 0.3.30

### Patch Changes

- [`95e26ea`](https://github.com/jant-me/jant/commit/95e26eaf9e5cfef4c00166587e9f0a9ce992d159) Thanks [@theowenyoung](https://github.com/theowenyoung)! - change tumbtail

## 0.3.29

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

## 0.3.9

### Patch Changes

- [`cc7dd4e`](https://github.com/jant-me/jant/commit/cc7dd4edeccb9aba737c5f11545ec0c45b769320) Thanks [@theowenyoung](https://github.com/theowenyoung)! - s3

## 0.3.8

### Patch Changes

- [`ad8ce6e`](https://github.com/jant-me/jant/commit/ad8ce6ebfafa9eebfff07d20da44ef5fc8d2d7ab) Thanks [@theowenyoung](https://github.com/theowenyoung)! - media improve

## 0.3.7

### Patch Changes

- [`9a7e08e`](https://github.com/jant-me/jant/commit/9a7e08e932c3d3896a303ef25825e7f2d0645bc3) Thanks [@theowenyoung](https://github.com/theowenyoung)! - collection and

## 0.3.6

### Patch Changes

- [`46a17c9`](https://github.com/jant-me/jant/commit/46a17c9a20754ab3c803602098d0175a9edd2458) Thanks [@theowenyoung](https://github.com/theowenyoung)! - i18n

## 0.3.5

### Patch Changes

- [`51f0367`](https://github.com/jant-me/jant/commit/51f03674e5324f3bfe1e71ca1b34e169c50179eb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - update /setup

## 0.3.4

### Patch Changes

- [`8c86db9`](https://github.com/jant-me/jant/commit/8c86db9b970d24213235ca841a8522788219da2a) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Update template

## 0.3.3

### Patch Changes

- [`b8a5057`](https://github.com/jant-me/jant/commit/b8a5057c7229c4b7f89b9063ed9bc8ab142811aa) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Add Test

## 0.3.2

### Patch Changes

- [`740de94`](https://github.com/jant-me/jant/commit/740de9441b740a440d530e904a8e9d56c158d693) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Add Account settings

## 0.3.1

### Patch Changes

- [`9655952`](https://github.com/jant-me/jant/commit/965595249fdd5d388db119600a70fcc6f56058fb) Thanks [@theowenyoung](https://github.com/theowenyoung)! - fix cookie expiers

## 0.3.0

### Minor Changes

- [`6870aa1`](https://github.com/jant-me/jant/commit/6870aa12c5cd32c9529d5caa9bdd957d43716037) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Architecture is nice now.

## 0.2.21

### Patch Changes

- [`6a421ae`](https://github.com/jant-me/jant/commit/6a421ae06426314da0c87d08656392c2b39ca498) Thanks [@theowenyoung](https://github.com/theowenyoung)! - fix d1

## 0.2.20

### Patch Changes

- [`858465b`](https://github.com/jant-me/jant/commit/858465ba86be4a47e8efcc4632fb32d7c0a87d21) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Skip confirm for creating database

## 0.2.19

### Patch Changes

- [`cecb444`](https://github.com/jant-me/jant/commit/cecb44403e3c25b3f92166d27a2edd68d11bf05e) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Change SSE action

## 0.2.18

### Patch Changes

- [`3b983cd`](https://github.com/jant-me/jant/commit/3b983cd60e371f1688829c84037e5abb9f110307) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Support Theme

## 0.2.17

### Patch Changes

- [`3bfb176`](https://github.com/jant-me/jant/commit/3bfb176b3f93c9eac6cc5966a46110b360502a27) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix createApp

## 0.2.16

### Patch Changes

- [`81af93c`](https://github.com/jant-me/jant/commit/81af93c8321b497f86c838fa3b18560d2a4fc430) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix tsconfig

## 0.2.15

### Patch Changes

- [`b2f299d`](https://github.com/jant-me/jant/commit/b2f299dbea6e924a0fc17ec5fb51af8c89902a2f) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix tsconfig

## 0.2.14

### Patch Changes

- [`adcc0b1`](https://github.com/jant-me/jant/commit/adcc0b1a244f2d64f58a580af6d14bde12948238) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix UI

## 0.2.13

### Patch Changes

- [`108090b`](https://github.com/jant-me/jant/commit/108090b52e8af0cb690cb99e24b3d2bd5d2a196b) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Fix i18n

## 0.2.12

### Patch Changes

- [`d43a020`](https://github.com/jant-me/jant/commit/d43a020e13e54823dc580df4e94f8e6096393484) Thanks [@theowenyoung](https://github.com/theowenyoung)! - Reflactor

## 0.2.11

### Patch Changes

- Fix css

## 0.2.10

### Patch Changes

- Fix css

## 0.2.9

### Patch Changes

- Fix css, Remove vite from core

## 0.2.8

### Patch Changes

- fix css

## 0.2.7

### Patch Changes

- Fix css

## 0.2.6

### Patch Changes

- Fix CSS

## 0.2.5

### Patch Changes

- Fix css

## 0.2.4

### Patch Changes

- Fix css

## 0.2.3

### Patch Changes

- fix css

## 0.2.2

### Patch Changes

- refletor css import

## 0.2.0

### Minor Changes

- Build: Pre-compile @jant/core before publishing
  - @jant/core now ships compiled JavaScript instead of TypeScript source
  - Includes TypeScript declaration files (.d.ts) for type support
  - Fixes "React is not defined" error in user projects
  - No special Vite configuration needed in user projects

## 0.1.3

### Patch Changes

- Fix: Move basecoat-css from devDependencies to dependencies

  This fixes the "basecoat-css/all could not be resolved" error when users install @jant/core in their projects.

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
