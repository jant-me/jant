---
"@jant/core": minor
"create-jant": minor
---

Smart Collections now support multi-value conditions and AND/OR matching, with a redesigned condition builder.

Inside a condition, Format, Collection, Year, Media, and Visibility let you pick more than one value (matching any of them). Across conditions, **Match** chooses whether a post must fit **All** conditions (AND, the default) or **Any** condition (OR), with an inline `and` / `or` toggle between rows and quick-add dimension pills replacing the old condition dropdown.

**Upgrade notes**

- Database migrations: SQLite `0040_aspiring_captain_america` and Postgres `0038_boring_bishop`. Run `jant migrate` on Workers/D1 deployments (Docker and Node run migrations automatically on startup).
- HTTP API and MCP: Smart Collection `selection` accepts optional `match` (`"all"` or `"any"`) and non-empty arrays on `collection`, `format`, `year`, and `visibility`; single values normalize back to scalars and `match: "all"` is omitted in responses. `/archive`, `GET /api/threads`, `GET /api/public/threads`, and `jant_threads_list` accept `match` and comma-separated values on `format`, `year`, and `visibility`. `POST /api/smart-collections/preview` also returns `years`.
- The site export format is now version 4, and the bundled Hugo `smart-collection-members.html` partial evaluates multi-value conditions and `match: any`.
