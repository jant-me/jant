---
"@jant/core": major
"create-jant": major
---

Jant 1.0. From this release, version numbers follow semantic versioning, and [Compatibility](https://jant.me/docs/compatibility) says what each kind of release can change. In-place upgrades, exports and snapshots, post and Collection addresses, and feed addresses and entry IDs keep working in every release, major ones included. The HTTP API, MCP tool names and parameters, the command line, configuration, feed contents, the export format, the Docker image name and data directory, `createApp`, and the project layout change only in a major release, whose upgrade notes say what to do.

The first 1.x release is 1.0.1 because `@jant/core@1.0.0` was published by accident in April 2026, and npm never accepts a version number twice. 1.0.0 is deprecated on npm.

**Upgrade notes**

- A site on a 0.x release goes through [Upgrading from 0.x](https://jant.me/docs/upgrading#upgrading-from-0x) first. These release notes list only what changed since 0.12.0.
