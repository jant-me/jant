---
"@jant/core": patch
"create-jant": patch
---

Site import works again, and a move between Jant sites or to the Hugo export keeps Thread order, times, navigation, redirects, smart collections, and feed entry IDs. Large sites can export, import, and snapshot. Adds `jant setup` for installs without a browser.

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
