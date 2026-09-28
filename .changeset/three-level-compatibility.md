---
"@jant/core": patch
"create-jant": patch
---

[Compatibility](https://jant.me/docs/compatibility) now sorts what Jant promises into three levels. In-place upgrades, exports and snapshots from 0.7.0 on, post and Collection addresses, and feed addresses and entry IDs keep working in every release, major ones included. The HTTP API, MCP tool names and parameters, the command line, configuration, feed contents, the export format, the Docker image name and data directory, `createApp`, and the project layout change only in a major release, whose upgrade notes say what to do. Theme hooks, MCP tool results, TypeScript types, and the exported Hugo templates are no longer promised; a release that changes one says so in its notes.

**Upgrade notes**

- No database migrations.
