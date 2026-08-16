# Multilingual: post-enable guidance and documentation

Follow-up to the copy review of the multilingual enable dialog. The author asked
where the "how do I actually use this" guidance belongs. Answer: not a tutorial
block — fix the confirmation that never shows, complete the section description
that already exists, and write the reference doc that does not exist yet.

Out of scope by the author's decision: localizing the post menu's translation UI
(`jant-post-menu.ts` is hardcoded English and stays that way for now).

## Findings that drove the plan

- `multilingualHelp` renders in both states (`jant-settings-language.ts:929`),
  so the description is the right home for the two entry points. It currently
  names only "link posts as translations", missing "write the other-language
  version", which is the menu's main action (`jant-post-menu.ts:1824`).
- The enable confirmation is dead copy: the route builds a toast
  (`routes/dash/settings.tsx:616-648`) but `#confirmEnable` never reads
  `result.toast` and reloads (`jant-settings-language.ts:438-467`). Every other
  mutation in that file calls `showToast`; `queueToastForNextPage()` exists for
  exactly the reload case (`client/toast.ts:405`, used by `compose-bridge.ts`).
- No multilingual doc exists. `docs/faq.md:74` is actively wrong: it points at
  **Settings → General → Language** and claims public pages are English-only.

## Plan

- [x] Queue the enable toast across the reload, with a test
- [x] Rewrite `multilingualHelp` to name both entry points (en + zh-Hans + zh-Hant)
- [x] Add a docs link to the Multilingual section, matching the
      `AdvancedContent.tsx:48` / `ApiTokensContent.tsx:288` inline pattern
- [x] Write `docs/multilingual.md` in the house docs voice
- [x] Mirror it as `docs/zh-Hans/multilingual.md`
- [x] Add both to `docs/SUMMARY.md` and `docs/zh-Hans/SUMMARY.md`
- [x] Replace the stale FAQ answer in both locales
- [x] Verify: i18n extract/compile, component tests, lint

## Results

**Code.** `#confirmEnable` and `#turnOffMultilingual` now queue their toast with
`queueToastForNextPage()` before reloading, so the enable confirmation — the only
place the stamped post count is ever stated — survives. Two tests cover it.
`#selectDashboardLanguage` reloads without a toast too, and was left alone: the
whole dashboard visibly switching language is the confirmation.

**Copy.** `multilingualHelp` now names both entry points ("write or link
other-language versions from a post's own menu"), and the section carries a
docs link in the `AdvancedContent` house pattern.

**Docs.** New `docs/multilingual.md` + `docs/zh-Hans/multilingual.md`, in both
SUMMARY files under "Use your site". `docs/API.md` gained the five language and
translation endpoints it never documented, plus `language` / `translationOfId`
in the create-post fields. The stale FAQ answer is replaced in both locales;
`configuration.md` and `writing-and-organizing.md` cross-link the new page.

**Verified.** `pnpm vitest run` in packages/core: 270 files, 3526 tests, all
passing. `mise run check-lint` clean. Prettier clean across docs and touched
source. i18n extract + compile run; the settings catalog has no untranslated
entries. `mise run check-tests` fails only at `tsc` on
`src/routes/pages/collection.tsx` (`c.req.param("slug")` is `string | undefined`)
— reproduced on a stashed clean tree, so it predates this work and is untouched
by it.

**Left undone by the author's decision.** `jant-post-menu.ts` stays hardcoded
English, so a zh-Hans dashboard shows English menu labels ("Change language",
"Write the {language} version"). Both guides quote those labels verbatim, which
matches what the user actually sees today. If that menu is ever localized, the
two guides need the labels updated with it.
