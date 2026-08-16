---
name: copy-style
description: Jant's writing rules for user-facing prose and copy. Use when writing or editing anything under docs/, README.md, or translations in src/i18n/locales/**/*.po, and when writing or reviewing UI strings (button labels, error messages, empty states, settings descriptions) in any locale. Also use when the user says copy reads "AI-flavored", 有 AI 味, too chatty, or asks to tighten documentation prose.
---

# Jant Copy Style

Jant reads like a quiet tool, not a companion. Full guide: `docs/internal/writing-style.md`.
UI-string rules: AGENTS.md § UX Copy Guidelines.

## The one rule

**Every word must buy information.**

You fail this structurally: you are trained to be helpful and complete, so you add coverage,
hedges, transitions and restatements — each locally justified, none ever removed, because nothing
in your generation loop deletes. Run one deliberate pass:

> Cut it. What did the reader lose? If nothing, it stays cut.

**Shorter is not the goal.** Cut past the load-bearing fact or the purpose clause and you have
made it worse. One real rewrite here came out 22 characters _longer_ and better: it lost an empty
antithesis and an ease claim, and bought `博客首页` (the fact that actually opposes a backend form)
and `这样事后可以持续完善` (what threading is for).

## Before writing

1. **Read the neighbors.** The surrounding section is the style guide of record — new copy must be
   indistinguishable from it. Do not write from these rules alone.
2. **Name the genre**: tutorial / how-to / reference / explanation, and stay in it. An overview
   states what the product does; walking the reader through clicks is how-to leaking in.
3. **Look up terminology**, never recall it: `src/i18n/locales/glossary.zh-Hans.yml` and
   `glossary.zh-Hant.yml`. In prose, follow the surrounding document — `overview.md` introduces
   concepts in English, so `Reply` is right there and `回复` is not. Be consistent within a clause.

## Waste a regex catches

`check-copy` handles these: `您`, exclamation marks, half-width punctuation in Chinese,
reassurance (`什么都不用选`, `别担心`), tour guide (`让我们`, `欢迎来到`), effort adjectives
(`轻松`, `只需`, `瞬间`, "simply", "easily", "seamlessly"). Also never: emoji, "successfully",
"Something went wrong" with no cause, cheerleading.

Two it cannot express: a metaphor is not a name (`Hidden from Latest`, not a softer synonym), and
a count can be an ease claim (`发布只有一步` sells, `发布一步完成` describes — but `一键部署` is a
product name and stays).

## Waste only reading aloud catches

Rhetoric added for effect. A combination of shapes, not a vocabulary — the checker sees almost
none of it. The tell is a beat: reveal, pause, payoff.

**It lives in bridge sentences** — the line introducing a list, the first line after a heading.
Substantive paragraphs survive; the model takes over in the connective tissue. House pattern for a
list intro is _count, don't console_:

✅ 在 Jant 中，帖子有三种可见性，默认是 Latest：

Then three habits to break:

- **Do not appraise significance.** State the fact; let the reader weigh it. `看起来很小，但…`,
  `这恰恰是…所在`, "it may seem minor, but" — the concrete half was always the good half.
- **Make the antithesis pay.** `A，不是 B` is right when B is a real alternative the reader might
  have assumed, wrong when B restates the clause before it. Most `不是` here are legitimate; do
  not go hunting.
- **Drop the emphasis machinery.** `V 的是 N` alone is ordinary Chinese. The problem is the stack:
  cleft + a measure word staging a reveal + a short standalone verdict as the payoff. Fold the
  verdict into the noun phrase, let the sentence hedge (`一般会`), join with a connective (`但是`).

Give clauses after a colon or dash **one grammatical shape**, or split the sentence. Four different
shapes strung with commas is a feature list smuggled into prose.

## 中文

- 人称统一「你」，禁止「您」。能省则省——`已发布` 好过 `你的帖子已发布`。
- 中文句内全角标点，引号用 `「」`。中英之间加空格，与全角标点之间不加。
- 反翻译腔：`{count} 个设置已显示` → `已显示 {count} 个设置`。`进行配置` → `配置`。
- 区分产品名词和普通名词：`帖子` 是 Jant 的 Post，`文章` 是别人写的。`我分享一些好文章` 是对的。
- **别过度纠正**：`V 的是 N`、`A，不是 B` 合法用例远多于问题用例。只在后半句不买信息时才动。
- **zh-Hant 不是简繁转换**：台湾惯用（設定、選集、貼文、權杖）。

## After writing

1. **Run the deletion test on every clause.** Catches more than the rest combined. Then reverse it:
   is the load-bearing fact actually stated?
2. `mise run check-copy`.
3. **Read every paragraph aloud**, not a sample. The section above is only audible.

## Lingui messages

Never bake runtime values into a `message` string — placeholders plus `values`, so extraction and
fallback stay correct. Normalize blank labels first; `0` and `false` are valid data, so no
truthiness fallbacks.

```tsx
i18n._(
  msg({
    message: "Found {count} results",
    comment: "@context: Search results count",
  }),
  {
    count,
  },
);
```
