# Writing Style (Long-Form Docs)

AGENTS.md's **UX Copy Guidelines** govern UI strings. This document governs **prose**: everything
under `docs/`, `README.md`, and multi-sentence `msgstr` values in `src/i18n/locales/**/*.po`.
Where the two overlap, AGENTS.md wins.

Every ✅ below is live text from this repo, verified by `mise run check-copy`. Change the doc and
you must change the example here, or the check fails. This file is a projection, never a second
source of truth.

## 1. The deletion test

**Every word must buy information.**

A model fails this structurally. It is trained to be helpful and complete, so it adds coverage,
hedges, transitions, restatements — each locally justified, none ever removed, because nothing in
generation deletes. One deliberate pass is the only counter-force:

> Cut it. What did the reader lose? If nothing, it stays cut.

**Shorter is not the goal.** The paragraph in § 4 came out 22 characters _longer_ after its
rewrite, and better: three zero-information phrases left, and three facts the reader needed
arrived. Cut past the load-bearing fact and you have made it worse. Measure information per
character, not characters.

## 2. Pick the genre, then stay in it

| Genre           | Answers                     | Voice                              |
| --------------- | --------------------------- | ---------------------------------- |
| **Tutorial**    | "walk me through it once"   | Imperative, ordered, one path only |
| **How-to**      | "I have a specific goal"    | Imperative, assumes competence     |
| **Reference**   | "what are the exact values" | Declarative, tabular, no narrative |
| **Explanation** | "why is it built this way"  | Essayistic, first person allowed   |

`why-blog.md` is pure Explanation and may be personal; `API.md` is pure Reference and may not.
A deliberate aphorism is fine in the first and wrong in the second.

The failure mode: a Reference table that grows a friendly paragraph about why you'd want the
feature. Move it to an Explanation section or cut it.

## 3. Waste a regex can catch

`check-copy` handles these, so they are not judgment calls. Errors: `您`, exclamation marks,
half-width punctuation inside Chinese, reassurance (`什么都不用选`, `别担心`), tour guide
(`让我们`, `欢迎来到`). Warnings: effort adjectives (`轻松`, `只需`, `瞬间`, "simply", "easily",
"seamlessly").

Two traps in the same family that no rule can express:

- **A metaphor is not a name.** If the UI says `Hidden from Latest`, the prose says
  `Hidden from Latest`. Never invent a softer synonym for something that already has a label.
- **A count can be an ease claim.** `发布只有一步` sells; `发布一步完成` describes. But
  `一键部署` is Cloudflare's "one-click deploy" flow — naming a thing, not selling it.

## 4. Waste only reading aloud catches

One disease: rhetoric added for effect. It is a combination of shapes, not a vocabulary, so the
checker sees almost none of it. The tell is a beat — reveal, pause, payoff.

**It concentrates in bridge sentences**: the line introducing a list, and the first line after a
heading. Substantive paragraphs carry real information and survive; the model takes over in the
connective tissue. Audit those lines first.

The house pattern for a list intro is **count, don't console**:

❌ 帖子默认就发到首页 Latest，什么都不用选。只有想让某条安静一点、或者想把它推给订阅者时，才需要动这一项：
✅ 在 Jant 中，帖子有三种可见性，默认是 Latest：

Reassurance the reader never asked for, a metaphor standing in for `Hidden from Latest` three
lines below, and a vague verb — replaced by a number.

**Do not appraise significance for the reader.** State the fact and let them weigh it. The tell is
setup-then-reverse: the text voices a dismissal on the reader's behalf so it can knock it down.

❌ 这个选项看起来很小，但没有它，这些内容我根本不会发。
✅ 没有这个选项，很多内容我应该并不会发。

The concrete half was always the good half. `看起来很小，但` was scaffolding.

**An antithesis must pay its way.** `A，不是 B` earns its place when B is a real alternative the
reader might have assumed — `/en/settings 是 404，不是英文版后台` corrects a live expectation. It
is filler when B restates the clause before it.

❌ 预览地址必须登录后才能访问，也不会被索引或缓存。它是作者的工作地址，不是可对外分享的公开链接。
✅ 预览地址必须登录后才能访问，也不会被索引或缓存。

Ask: does the "not B" half tell the reader anything they did not already have? Eleven of the
thirteen `不是` constructions in this repo pass that test. Do not go hunting for them.

**Emphasis machinery.** `V 的是 N` alone is ordinary Chinese — `运行的是同一份代码` is correct, and
nineteen such sentences here are fine. What reads as machine-written is the stack: a cleft, plus a
measure word staging a reveal, plus a short standalone verdict as the payoff. This paragraph had
all of it, and is where most of this document came from:

❌ 传统博客给你一张表单：标题、正文、分类、标签、摘要、SEO、封面图。这是管理内容的界面，不是写东西的界面。Jant 的发布体验更接近 Tumblr, Twitter, 标题可选，随时追加成 Thread，发布只需要一个步骤。
✅ 传统博客一般会给你提供这样一个管理内容的表单：标题、正文、分类、标签、摘要、SEO、封面图。但是 Jant 借鉴的是更加具有人体工学的 Tumblr / Twitter 界面：博客首页快速发布，标题可选，同时支持 Reply 串成 Thread，这样事后可以持续完善。

Four repairs. Fold the verdict into the noun phrase (`管理内容的表单`) instead of dropping it as a
separate beat. Let the sentence hedge the way speech does (`一般会`). Join the contrast with a
connective (`但是`) rather than juxtaposing. And give the clauses after the colon one shape —
the ❌ version strings four different grammatical shapes together, which is a feature list smuggled
into prose. Watch for that after an em-dash especially: the dash promises elaboration and gets
filled with specs.

What the rewrite bought: `博客首页` (the fact that actually opposes a backend form),
`更加具有人体工学的` (why Tumblr), `这样事后可以持续完善` (what threading is for).

## 5. Terminology

`packages/core/src/i18n/locales/glossary.zh-Hans.yml` and `glossary.zh-Hant.yml` are the source of
truth — not this file, not memory.

The glossary governs UI strings. In prose, product nouns follow the surrounding document:
`overview.md` introduces concepts in English (Note, Link, Quote, Thread, Featured), so `Reply` is
right there and `回复` is not. Be consistent within a clause.

Distinguish the product noun from the generic one: `帖子` is a Jant Post, `文章` is an article
someone else wrote. `我分享一些好文章` is correct and must not be "fixed" — the checker only flags
`文章` inside PO files, where the English `msgid` settles it.

## 6. 中文文案

AGENTS.md 的「中文文案」是底线，这里只补长文档特有的。

- **人称**：统一「你」，禁止「您」。能省则省——`已发布` 好过 `你的帖子已发布`。
- **标点**：中文句内一律全角。引号用 `「」`，不用 `""`。纯英文、数字、代码、URL 保持半角。
- **中英混排**：中文与英文/数字之间加空格（`发布到 Latest`），与全角标点之间不加。
- **反翻译腔**：先想中文里本来怎么说。`{count} 个设置已显示` 是翻译腔，`已显示 {count} 个设置` 才像话。
  `进行配置` → `配置`。双重「将…以…将」这类结构一律拆开。
- **别过度纠正**：`V 的是 N`、`A，不是 B` 在本仓库合法用例远多于问题用例。只在后半句不买信息时才动。
- **zh-Hant 不是简繁转换**：按台湾惯用（設定、選集、貼文、權杖）。

## 7. 复查清单

1. **逐字过删除测试**（§ 1）。这一步清掉的问题比其余加起来还多。反向再问一次：承重的事实说清楚了吗？
2. `mise run check-copy` —— 机械违规清干净。
3. 每个 `：` 结尾的引导句、每个 `##` 后的第一句，逐个念。
4. **每一段都大声读**，不是抽样。§ 4 那些只能听出来。听到「揭晓—停顿—落包袱」就是它。

## 参考

- **[Diátaxis](https://diataxis.fr/)** —— § 2 四种体裁的出处。
- **[GOV.UK style guide](https://www.gov.uk/guidance/style-guide)** —— 最不废话的公共写作标准，和
  AGENTS.md 的 "quiet tool, not a companion" 最接近。
- **[Google developer documentation style guide](https://developers.google.com/style)** —— 带 word
  list，当查询手册用。
- **[《中文文案排版指北》](https://github.com/sparanoid/chinese-copywriting-guidelines)** —— 标点与中英混排。
