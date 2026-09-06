# Discover becomes opt-in for self-hosted, opt-out for hosted

## Why

`resolveDiscoverMode` falls back to `latest` when nothing is stored, so an
ordinary self-hosted site declares `latest` in every feed without its owner
ever opening the control. In practice most such sites are not listed, because
the directory only hears about a site when the owner saves the setting and the
one-off ping fires — but that is an accident of plumbing, not consent. The
submission endpoint is deliberately unauthenticated and the verification step
only checks the declaration, so **anybody** can submit a stranger's self-hosted
feed and get it listed on the strength of a default the owner never chose.

The declaration is meant to be the consent record. Make it one.

Hosted Jant still wants every blog listed by default. That is a property of the
deployment, not of the software, so it belongs in the deployment's environment.

## Design

**Self-hosted default is `none`.** A site that has never touched the control
declares `none` and is refused at verification. The owner ticks the box, the
setting is stored, the ping fires, and only then can the site be listed.

**Hosted default comes from the existing `DISCOVER` binding.** The hosted
`jant-core` deployment sets `DISCOVER=latest`; every site it serves declares
`latest` until its owner says otherwise. Nothing new is invented — `DISCOVER`
already existed as an env binding.

**The env binding is a default, not a choice.** `resolveDiscoverMode` takes
`storedValue` and `defaultValue` separately, and the order becomes:

1. demo → `none`
2. feeds off → `none`
3. stored value → that (the owner's own choice, and it beats `noindex`)
4. `noindex` → `none`
5. deployment default → that
6. otherwise → `none`

`noindex` now sits **above** the deployment default rather than below the
merged "explicit" value. That is the point of splitting them: a hosted owner
who hides from search engines should not stay in a public directory because
the deployment said `latest`.

**Not-opted-in declares `none`, not an absent element.** Absence keeps its one
meaning — a Jant older than Discover — and `none` widens from "said no" to
"not listed", covering "never said yes" as well. A directory reads both the
same way; only the sunset rule cares, and it should keep treating silence as
"old version".

### Rejected

- **Omitting the element when not opted in.** It would make silence ambiguous
  between "old Jant" and "declined", which is exactly the distinction the
  protocol's sunset rule depends on.
- **A new `DISCOVER_DEFAULT` binding.** `DISCOVER` already reads as
  "DB row, else env, else default" everywhere else in the settings registry.
  A second key for the same job is one more thing to explain.
- **Treating the env value as an explicit choice (today's behaviour).** It
  makes `noindex` inert on hosted sites, and it makes "the owner chose this"
  unrepresentable in the settings UI.

## Also in scope: the maturity threshold drifted

Core says the directory wants 3 public posts and a 7-day-old oldest post.
jant.me now asks for 1 post and no history at all, and shows the core numbers
to the owner on the settings page. Sync core to the real rule and drop the age
dimension: it is 0 in the directory's own defaults, and the directory's own
notes explain why it is not going back up (for a self-hosted feed the date
comes from the oldest post the feed still carries — strict against an honest
blog, no obstacle at all to one that backdates).

## Steps

- [x] `lib/discover.ts`: split the signature, reorder the rules, fall back to
      `none`; `DISCOVER_MIN_PUBLIC_POSTS` 3 → 1; drop `DISCOVER_MIN_AGE_DAYS`
      and `ageDays` from `measureDiscoverMaturity`.
- [x] `lib/env.ts`: `getDiscoverDefault(env)`.
- [x] `lib/resolve-config.ts`: pass stored and default separately.
- [x] `routes/dash/settings.tsx`: read `declaredMode` off `appConfig.discover`
      (it already ignores the env binding today, which is a latent bug); pass
      the deployment default down; drop the `earliestPublishedAt` query;
      `announceInBackground` takes the default too.
- [x] `ui/dash/settings/GeneralContent.tsx`: `discoverDefault` prop, status
      copy without the age.
- [x] `client/components/jant-settings-general.ts`: checkbox follows the
      deployment default when nothing is stored; Save is a plain dirty check
      now that confirming a default is no longer how a site opts in.
- [x] `types/config.ts`: correct the `DISCOVER` comment.
- [x] Docs: `docs/discover.md`, `docs/zh-Hans/discover.md`,
      `docs/configuration.md`.
- [x] i18n: extract, translate zh-Hans and zh-Hant, compile.
- [x] Tests: `lib/__tests__/discover.test.ts`.
- [x] Verify: `mise run check-types`, `check-tests`, `check-lint`,
      `check-copy`.

## Cross-repo

`jant-cloud` must record the dependency in `docs/core-integration.md`: the
hosted `jant-core` deployment has to set `DISCOVER=latest` or every hosted
blog will declare `none`, and `reconcileHostedFleet` will enrol them only for
the next poll to self-delist them.

## The announcement block on a hosted blog

The announcement answers one question: _does the directory know my address?_
It exists because a directory cannot list a self-hosted site it has never heard
of. A blog on a hosted platform is never in that position — `reconcileHostedFleet`
enrols the whole fleet from `cloud_site` — so an owner who has never touched the
control is already listed while the status block tells them "Not announced yet.
Save this section to announce your site." A non-problem, and a non-action.

Gated on `isHostedControlPlaneEnabled` (`host-based` plus a configured control
plane), which had no callers until now. On such a deployment the three
announcement states, the Retry button, the manual submission link, and the
"read within N hours" line are all dropped. What is left is what the owner can
act on: what the feed declares, the featured-with-no-featured-posts warning,
and the maturity line.

**The ping still fires.** It is not redundant on a hosted blog: a directory
reads a repeat ping as "read me now" and schedules an immediate poll
(`services/discover.ts` in the cloud), so switching Discover back on recovers in
one crawler tick instead of waiting out `selfDelistedPollIntervalSeconds` — a
week in production. `updateDiscoverSetting` already announces on `off` → on, so
that path works today. It is plumbing rather than a task, so it is reported
nowhere.

### Rejected

- **Gating on "participating because of the deployment default"**
  (`stored === null && default !== "none"`). Wrong condition: a self-hosted
  operator running several blogs off one deployment can set `DISCOVER=latest`
  too, and nothing enrols _those_ — they still need the announcement.
- **Suppressing the ping for hosted blogs.** It is the only signal that makes
  a re-enabled blog come back in a tick rather than a week.
- **Hiding the `discoverAnnounce` help text as well.** The ping really is sent,
  and a line saying so should not disappear just because the block around it
  did.

### Left open

If the ping fails on a hosted blog, the owner now sees nothing and the blog
waits out the week-long self-delisted backstop. That backstop is a cloud-side
number, and a hosted fleet is known and cheap to re-read, so the fix belongs
there rather than in an error message about the host's own plumbing.

## Results

Landed as designed. Notes worth keeping:

- `routes/dash/settings.tsx` was deriving `declaredMode` from
  `allSettings["DISCOVER"]` alone, so the status block never saw the env
  binding. It now reads `appConfig.discover`, which is the same derivation the
  feeds use.
- `posts.getEarliestPublishedAt` had no caller left once the age dimension went,
  so it is gone from the service and its interface.
- `.env.example` and `packages/core/.env.node.example` documented
  `DISCOVER=latest` as a site default; they now show `off` and say what the
  binding actually is.
- `GeneralContent`'s test fixtures still carried `ageDays` / `minAgeDays` and a
  threshold of 3. Tests are excluded from `tsconfig.server.json`, so nothing
  caught it; they are synced now.

Verified: `check-types`, `check-lint`, `check-format`, `check-copy`, and the
full `check-tests` suite. One pre-existing failure is unrelated and reproduces
on a clean tree: `src/node/__tests__/cli-site-snapshot.test.ts >
auto-remaps a snapshot into the only initialized site in single-site mode`.
`i18n-check` reports "out of sync" only because it diffs the catalogs against
git; it passes once the `.po` changes are committed.

## Before this is deployed

Hosted `jant-core` must get `DISCOVER=latest` in its environment **before or
with** this release. Without it every hosted blog declares `none`, and the
directory's next poll self-delists the whole fleet.
