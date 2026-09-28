---
"@jant/core": patch
"create-jant": patch
---

The API reference matches the API again. The surface table lists smart collections and Discover; `GET /api/collections` documents `lang`; the translation candidates document their `candidates` wrapper; custom URL paths are documented with the leading slash they carry; the MCP protocol header is documented as optional; examples show `sortOrder`, `durationSeconds`, and a `null` media `nextCursor`; and the author post endpoints no longer sit under the Public posts heading. A test now holds every JSON example to its field table.

**Upgrade notes**

- No database migrations.
