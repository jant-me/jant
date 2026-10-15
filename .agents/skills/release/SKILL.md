---
name: release
description: Create a Jant release changeset for @jant/core and create-jant using the repository's fixed-version workflow. Use when the user invokes $release by itself, asks to release, prepare a changeset, add a changeset, cut release notes, or run the old Claude release command.
---

# Create a Release Changeset

Create one changeset file for `@jant/core` and `create-jant`. Jant uses fixed
versioning, so both packages always release together. This workflow only creates
and commits the changeset file; CI handles version bumps, changelogs, and
publishing.

## Default Invocation

When invoked with no additional user instructions, treat the invocation as a
request to run this workflow now. Start by checking changeset status and
summarizing unreleased commits.

## Workflow

1. Run `mise run changeset-status` to check for pending changesets.
2. Summarize unreleased commits with:

   ```bash
   git log $(git describe --tags --abbrev=0)..HEAD --oneline
   ```

3. Show the user the unreleased summary and determine the version bump:
   `patch`, `minor`, or `major`. Use a bump already supplied by the user; if no
   bump is supplied and the user does not answer, default to `patch`.
4. Write a concise changelog summary from the commits.
5. Run the repository task to create the changeset:

   ```bash
   mise run changeset-add <bump> "<summary>"
   ```

6. Stage and commit only the new `.changeset/*.md` file with:

   ```bash
   git add .changeset/<new-file>.md
   git commit -m "chore: add changeset"
   ```

7. Report the committed changeset and remind the user to create a PR.

## Rules

- Do not run `mise run version`, `mise run release`, or
  `mise run release-local`.
- Do not modify `package.json`, `CHANGELOG.md`, or files other than the new
  `.changeset/*.md` file.
- Use `mise run changeset-add`; do not write changeset files by hand.
- A `major` bump writes its upgrade notes into `docs/upgrading.md` and
  `docs/zh-Hans/upgrading.md` first, as end states, and the changeset links
  there (see `docs/RELEASING.md`).
- Do not stage or commit unrelated work. If the working tree contains existing
  changes, leave them untouched unless they are the new changeset file.
