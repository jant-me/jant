/**
 * Every `jant` command, classified.
 *
 * Public commands are part of Jant's compatibility promise: their names,
 * options, and behavior change only in a major release, and `docs/cli.md`
 * documents each one. Internal commands are build and operations tooling for
 * the Jant repository and the hosted service. They still run, but help leaves
 * them out and they can change in any release.
 *
 * `src/__tests__/cli-commands.test.ts` fails when a file under
 * `bin/commands/` is in neither list, so a new command has to be classified
 * before it ships.
 */

/**
 * @typedef {object} PublicCommand
 * @property {string} name Space-separated command path, e.g. `site export`
 * @property {string} summary One-line description shown by `jant --help`
 */

/**
 * @typedef {object} PublicCommandGroup
 * @property {string} title Group heading shown by `jant --help`
 * @property {PublicCommand[]} commands Commands in display order
 */

/** @type {PublicCommandGroup[]} */
export const PUBLIC_COMMAND_GROUPS = [
  {
    title: "Set up and run",
    commands: [
      {
        name: "setup",
        summary: "Create the owner account and site without a browser",
      },
      { name: "start", summary: "Start the Node.js server" },
      {
        name: "migrate",
        summary: "Apply database migrations and data backfills",
      },
      {
        name: "deploy",
        summary: "Apply remote migrations and deploy to Cloudflare Workers",
      },
      {
        name: "reset-password",
        summary: "Generate a password reset token",
      },
    ],
  },
  {
    title: "Move and back up content",
    commands: [
      {
        name: "site export",
        summary: "Export a site as a Hugo site, as a ZIP or a directory",
      },
      { name: "site import", summary: "Import a Hugo site export into a site" },
      {
        name: "site pull-media",
        summary: "Download the media a site export refers to",
      },
      {
        name: "site snapshot export",
        summary: "Export a snapshot that keeps IDs, storage keys, and files",
      },
      {
        name: "site snapshot import",
        summary: "Restore a snapshot into a site",
      },
      { name: "db export", summary: "Export the database to a SQL file" },
    ],
  },
  {
    title: "Maintenance",
    commands: [
      { name: "search reindex", summary: "Rebuild the search index" },
      {
        name: "posts rebuild-html",
        summary: "Rebuild stored post HTML at the current format",
      },
      {
        name: "uploads cleanup",
        summary: "Clear expired uploads and purge deleted media",
      },
      {
        name: "telegram register-webhooks",
        summary: "Register the webhooks of the Telegram bots",
      },
    ],
  },
];

/**
 * Build and operations tooling, left out of help and out of the
 * compatibility promise.
 *
 * @type {string[]}
 */
export const INTERNAL_COMMANDS = [
  "assets prepare",
  "assets upload",
  "db execute-file",
  "db rehearse",
];

/**
 * Names of all public commands, in display order.
 *
 * @returns {string[]} Space-separated command paths
 * @example
 * ```js
 * listPublicCommandNames(); // ["setup", "start", …, "telegram register-webhooks"]
 * ```
 */
export function listPublicCommandNames() {
  return PUBLIC_COMMAND_GROUPS.flatMap((group) =>
    group.commands.map((command) => command.name),
  );
}
