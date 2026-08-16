#!/usr/bin/env node
/**
 * Copy style checker.
 *
 * Enforces the mechanical parts of AGENTS.md § UX Copy Guidelines and
 * docs/internal/writing-style.md across user-facing prose and translations.
 *
 * Scans:
 *   - docs/ **.md and README.md
 *   - packages/core/src/i18n/locales/ ** /*.po (msgstr values only)
 *
 * Judgment calls stay with the author. Errors fail the run; warnings do not.
 *
 * Suppress a single line by putting `copy-ok` in it, or by marking it with ❌
 * (lines demonstrating bad copy are skipped automatically).
 *
 * Usage:
 *   node scripts/check-copy.mjs            # errors + warnings, exit 1 on error
 *   node scripts/check-copy.mjs --quiet    # errors only
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const QUIET = process.argv.includes("--quiet");

const CJK = "\\u4e00-\\u9fff\\u3400-\\u4dbf";
const cjk = (body) => new RegExp(body.replaceAll("CJK", CJK), "gu");

/**
 * Files that document bad copy and would otherwise flag themselves.
 */
const EXCLUDED = new Set([
  join("docs", "internal", "writing-style.md"),
  join(".claude", "skills", "copy-style", "SKILL.md"),
]);

const ZH = ["zhHans", "zhHant"];

/**
 * @typedef {object} Rule
 * @property {string} id           Stable identifier, shown in output.
 * @property {string[]} langs      Which locales the rule applies to.
 * @property {"error"|"warn"} severity
 * @property {RegExp} pattern      Must carry the `g` flag.
 * @property {string} message      What to do about it.
 */

/** @type {Rule[]} */
const RULES = [
  // ---- Chinese: always wrong -------------------------------------------------
  {
    id: "zh-honorific",
    langs: ZH,
    severity: "error",
    pattern: /您/gu,
    message: "统一用「你」，不用「您」",
  },
  {
    id: "zh-exclamation",
    langs: ZH,
    severity: "error",
    pattern: /！/gu,
    message: "不用感叹号",
  },
  {
    id: "zh-particle",
    langs: ZH,
    severity: "error",
    pattern: cjk("[哦啦哟耶](?=[。，、？」）)\\s]|$)"),
    message: "不用语气词卖萌（哦、啦、哟）",
  },
  {
    id: "zh-account",
    langs: ZH,
    severity: "error",
    pattern: /帐户/gu,
    message: "写「账户」，不写「帐户」",
  },
  {
    id: "zh-halfwidth-punct",
    langs: ZH,
    severity: "error",
    pattern: cjk("(?:[CJK][,;:?!]|[,;:?!][CJK])"),
    message: "中文句内用全角标点（，；：？）",
  },
  {
    id: "zh-reassurance",
    langs: ZH,
    severity: "error",
    pattern:
      /什么都不用|甚麼都不用|别担心|別擔心|不用担心|不用擔心|无需担心|無需擔心|请放心|請放心|其实很简单|其實很簡單|非常简单|非常簡單/gu,
    message: "删掉安抚句——读者没说他焦虑",
  },
  {
    id: "zh-tour-guide",
    langs: ZH,
    severity: "error",
    pattern:
      /让我们|讓我們|接下来我们|接下來我們|欢迎来到|歡迎來到|开启.{0,6}之旅|開啟.{0,6}之旅/gu,
    message: "删掉导游腔——文档是跳着读的",
  },

  // ---- Chinese: needs a human look ------------------------------------------
  {
    id: "zh-effort-adjective",
    langs: ZH,
    severity: "warn",
    pattern:
      /轻松|輕鬆|轻而易举|輕而易舉|瞬间完成|瞬間完成|强大的|強大的|完美地|无缝|無縫|一目了然/gu,
    message: "删掉效率形容词——不携带信息",
  },
  {
    id: "zh-translationese",
    langs: ZH,
    severity: "warn",
    pattern:
      /进行.{0,4}操作|進行.{0,4}操作|对.{0,8}进行|對.{0,8}進行|通过.{0,6}的方式|透過.{0,6}的方式/gu,
    message: "改成直接的动词（进行配置 → 配置）",
  },
  {
    // Setup-then-reverse: the text voices a dismissal for the reader so it can
    // knock it down. Warn, not error — "状态看起来是 Active，但…" is a real
    // technical statement, so a human has to tell rhetoric from fact.
    id: "zh-significance-claim",
    langs: ZH,
    severity: "warn",
    pattern:
      /看[起上][来去].{0,12}[但却]|乍[看一]看?.{0,12}[但却]|你可能会?[觉認认]得?为?.{0,20}[但其]|虽然只是|雖然只是|恰恰是.{0,10}所在|魅力所在|意义所在|意義所在|价值所在|價值所在/gu,
    message: "别替读者评估重要性——陈述事实，删掉「看起来…但…」的支架",
  },
  {
    // Empty antithesis. `A，不是 B` is usually legitimate — 11 of 13 instances in
    // this corpus name a real alternative. The one reliable tell a regex can see
    // is the same head noun on both sides ("…的界面，不是…的界面"), which is
    // cadence rather than information. Everything else is a human judgment call;
    // see the review checklist in docs/internal/writing-style.md.
    id: "zh-empty-antithesis",
    langs: ZH,
    severity: "warn",
    pattern:
      /是[^，。；：]{1,12}的([^，。；：的]{1,6})，(?:而)?不是[^，。；：]{1,12}的\1/gu,
    message: "对偶两边是同一个词——后半句只提供节奏，不提供信息",
  },
  {
    id: "zh-straight-quotes",
    langs: ZH,
    severity: "warn",
    pattern: cjk('"[^"]*[CJK][^"]*"'),
    message: "中文引号用「」，不用半角双引号",
  },

  // ---- Locale-specific terminology ------------------------------------------
  {
    id: "hant-simplified-term",
    langs: ["zhHant"],
    severity: "error",
    pattern: /帖子|令牌|合集/gu,
    message: "zh-Hant 用台湾惯用词：貼文、權杖、選集",
  },
  {
    id: "hans-traditional-term",
    langs: ["zhHans"],
    severity: "error",
    pattern: /貼文|權杖|選集/gu,
    message: "zh-Hans 用：帖子、令牌、合集",
  },

  // ---- English: always wrong -------------------------------------------------
  {
    id: "en-successfully",
    langs: ["en"],
    severity: "error",
    pattern: /\bsuccessfully\b/giu,
    message: 'never say "successfully" — if it worked, the user knows',
  },
  {
    id: "en-cheerleading",
    langs: ["en"],
    severity: "error",
    pattern:
      /\b(oops|awesome|great job|you're all set|hooray|congrats|congratulations)\b/giu,
    message: "no cheerleading",
  },
  {
    id: "en-tour-guide",
    langs: ["en"],
    severity: "error",
    pattern: /\b(let's|welcome aboard|your journey|ready to\b.*\?)/giu,
    message: "no tour-guide framing",
  },
  {
    id: "en-vague-failure",
    langs: ["en"],
    severity: "error",
    pattern: /something went wrong/giu,
    message: "name the cause and the next step",
  },

  // ---- English: needs a human look ------------------------------------------
  {
    id: "en-filler",
    langs: ["en"],
    severity: "warn",
    pattern: /\b(simply|effortlessly|seamlessly|instantly|feel free to)\b/giu,
    message: "filler — delete it",
  },
  {
    id: "en-powerful",
    langs: ["en"],
    severity: "warn",
    pattern: /\bpowerful\b/giu,
    message: "marketing adjective — say what it does instead",
  },
  {
    id: "en-significance-claim",
    langs: ["en"],
    severity: "warn",
    pattern:
      /\b(it (may|might) seem|you (may|might) think|at first glance|don't be fooled|this is where the real)\b/giu,
    message: "state the fact; let the reader weigh it",
  },
];

/**
 * Replace a slice of `text` with spaces so line/column offsets stay stable.
 *
 * @param {string} text
 * @param {RegExp} pattern Global regex describing the regions to blank out.
 * @returns {string} Same-length text with matched regions replaced by spaces.
 * @example
 * mask("a `code` b", /`[^`]*`/g); // => "a        b"
 */
function mask(text, pattern) {
  return text.replace(pattern, (match) => match.replace(/[^\n]/gu, " "));
}

/**
 * Blank out everything in a Markdown file that is not prose: front matter,
 * fenced and inline code, HTML comments, URLs and link targets.
 *
 * @param {string} text Raw Markdown source.
 * @returns {string} Same-length text with non-prose regions blanked.
 */
function maskMarkdown(text) {
  let out = text;
  out = mask(out, /^---\n[\s\S]*?\n---/u);
  out = mask(out, /^```[\s\S]*?^```/gmu);
  out = mask(out, /`[^`\n]*`/gu);
  out = mask(out, /<!--[\s\S]*?-->/gu);
  out = mask(out, /\]\([^)\n]*\)/gu);
  out = mask(out, /https?:\/\/\S+/gu);
  return out;
}

/**
 * Extract translated strings from a PO file, paired with their English source.
 *
 * Only `msgstr` values are checked — `msgid` holds the English source, which is
 * reviewed where it is authored. It is carried along so terminology rules can
 * tell a Jant Post from an article someone else wrote.
 *
 * @param {string} text Raw PO source.
 * @returns {Array<{line: number, text: string, msgid: string}>} One entry per msgstr, 1-indexed.
 * @example
 * parsePo('msgid "Latest posts"\nmsgstr "最新帖子"');
 * // => [{ line: 2, text: "最新帖子", msgid: "Latest posts" }]
 */
function parsePo(text) {
  const lines = text.split("\n");
  const entries = [];
  let current = null;
  let msgid = "";
  let inMsgid = false;

  const flush = () => {
    if (current) entries.push(current);
    current = null;
  };

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();

    const idStart = /^msgid(?:_plural)?\s+"(.*)"$/u.exec(line);
    if (idStart) {
      flush();
      msgid = idStart[1];
      inMsgid = true;
      continue;
    }

    const strStart = /^msgstr(?:\[\d+\])?\s+"(.*)"$/u.exec(line);
    if (strStart) {
      flush();
      inMsgid = false;
      current = { line: index + 1, text: strStart[1], msgid };
      continue;
    }

    const continuation = /^"(.*)"$/u.exec(line);
    if (continuation) {
      if (inMsgid) msgid += continuation[1];
      else if (current) current.text += continuation[1];
      continue;
    }

    flush();
    inMsgid = false;
  }
  flush();

  const unescape = (s) => s.replaceAll('\\"', '"').replaceAll("\\n", " ");
  return entries
    .map((entry) => ({
      line: entry.line,
      text: unescape(entry.text),
      msgid: unescape(entry.msgid),
    }))
    .filter((entry) => entry.text.trim() !== "");
}

/**
 * Infer which locale's rules apply to a file.
 *
 * @param {string} path Repo-relative path.
 * @returns {"zhHans"|"zhHant"|"en"}
 */
function localeOf(path) {
  if (path.includes("zh-Hant")) return "zhHant";
  if (path.includes("zh-Hans")) return "zhHans";
  return "en";
}

/**
 * Whether a line opts out of checking.
 *
 * Lines marked with ❌ demonstrate bad copy on purpose; `copy-ok` is the
 * explicit escape hatch.
 *
 * @param {string} line
 * @returns {boolean}
 */
function suppressed(line) {
  return line.includes("❌") || line.includes("copy-ok");
}

/**
 * Run every applicable rule over one unit of text.
 *
 * @param {string} text Prose to check (already masked/extracted).
 * @param {number} line 1-indexed line number to report.
 * @param {string} locale
 * @returns {Array<{line: number, severity: string, id: string, message: string, match: string}>}
 */
function checkText(text, line, locale) {
  if (suppressed(text)) return [];
  const findings = [];
  for (const rule of RULES) {
    if (!rule.langs.includes(locale)) continue;
    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(text);
    if (match) {
      findings.push({
        line,
        severity: rule.severity,
        id: rule.id,
        message: rule.message,
        match: match[0].trim(),
      });
    }
  }
  return findings;
}

/**
 * Recursively collect files under `dir` matching one of `extensions`.
 *
 * @param {string} dir Absolute directory path.
 * @param {string[]} extensions e.g. [".md"]
 * @returns {string[]} Absolute file paths.
 */
function walk(dir, extensions) {
  let found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found = found.concat(walk(path, extensions));
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Verify that every ✅ example in the style guide is still the live text.
 *
 * The guide's before/after pairs are the anchor corpus a writer imitates, so a
 * stale ✅ teaches the wrong thing. Treat the guide as a projection of the repo,
 * never a second source of truth: each ✅ must appear verbatim in some doc or PO
 * file. Lines containing `…` are excerpts and are skipped.
 *
 * @param {string[]} corpus Raw contents of every scanned file.
 * @returns {Array<{line: number, severity: string, id: string, message: string, match: string}>}
 */
function checkStyleGuideExamples(corpus) {
  const findings = [];
  for (const source of [...EXCLUDED]) {
    let guide;
    try {
      guide = readFileSync(join(ROOT, source), "utf8");
    } catch {
      continue;
    }

    for (const [index, raw] of guide.split("\n").entries()) {
      const match = /^\s*(?:>\s*)?✅\s*(.+?)\s*$/u.exec(raw);
      if (!match) continue;

      const example = match[1].replaceAll("**", "").replaceAll("`", "");
      if (example.includes("…")) continue;

      if (!corpus.some((text) => text.includes(example))) {
        findings.push({
          source,
          line: index + 1,
          severity: "error",
          id: "style-guide-drift",
          message: "这条 ✅ 已不是仓库现文——文档改了就要同步改示例",
          match: example.slice(0, 40),
        });
      }
    }
  }
  return findings;
}

function main() {
  const targets = [
    ...walk(join(ROOT, "docs"), [".md"]),
    join(ROOT, "README.md"),
    ...walk(join(ROOT, "packages", "core", "src", "i18n", "locales"), [".po"]),
  ];

  const byFile = new Map();
  const corpus = [];
  let errors = 0;
  let warnings = 0;

  for (const absolute of targets) {
    const path = relative(ROOT, absolute);
    if (EXCLUDED.has(path)) continue;

    let raw;
    try {
      raw = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }

    corpus.push(raw);

    const locale = localeOf(path);
    const findings = [];

    if (path.endsWith(".po")) {
      const postTerm = { zhHans: "帖子", zhHant: "貼文" }[locale];
      for (const entry of parsePo(raw)) {
        findings.push(...checkText(entry.text, entry.line, locale));

        // Terminology, but only where the English source actually says "post".
        // In prose there is no such signal, so `文章` is left to the author —
        // "我分享一些好文章" is correct and must not be "fixed".
        if (
          postTerm &&
          /\bposts?\b/iu.test(entry.msgid) &&
          entry.text.includes("文章")
        ) {
          findings.push({
            line: entry.line,
            severity: "error",
            id: "zh-post-term",
            message: `msgid 说的是 post，译文要用「${postTerm}」`,
            match: "文章",
          });
        }

        // Half-width sentence-final period, e.g. "將精選文章用於 /feed."
        // Ellipsis ("处理中...") is a progress marker, not a sentence end.
        const trailing = entry.text.trim();
        if (
          locale !== "en" &&
          /[一-鿿]/u.test(trailing) &&
          /\.$/u.test(trailing) &&
          !/(\.\.\.|…)$/u.test(trailing) &&
          !suppressed(trailing)
        ) {
          findings.push({
            line: entry.line,
            severity: "error",
            id: "zh-halfwidth-period",
            message: "中文句子用全角句号「。」",
            match: trailing.slice(-12),
          });
        }
      }
    } else {
      const masked = maskMarkdown(raw).split("\n");
      for (const [index, line] of masked.entries()) {
        findings.push(...checkText(line, index + 1, locale));
      }
    }

    const visible = QUIET
      ? findings.filter((f) => f.severity === "error")
      : findings;
    if (visible.length > 0) byFile.set(path, visible);
    errors += findings.filter((f) => f.severity === "error").length;
    warnings += findings.filter((f) => f.severity === "warn").length;
  }

  for (const finding of checkStyleGuideExamples(corpus)) {
    const existing = byFile.get(finding.source) ?? [];
    byFile.set(finding.source, [...existing, finding]);
    errors += 1;
  }

  for (const [path, findings] of byFile) {
    console.log(`\n${path}`);
    for (const finding of findings.sort((a, b) => a.line - b.line)) {
      const tag = finding.severity === "error" ? "error" : "warn ";
      console.log(
        `  ${tag} ${path}:${finding.line}  ${finding.message}  [${finding.id}] → ${finding.match}`,
      );
    }
  }

  console.log(
    `\n${errors} error(s), ${warnings} warning(s) across ${targets.length} file(s).`,
  );
  if (errors > 0) {
    console.log("Fix the errors, or mark an intentional line with `copy-ok`.");
    console.log("Rules: docs/internal/writing-style.md");
  }
  process.exit(errors > 0 ? 1 : 0);
}

main();
