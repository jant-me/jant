/**
 * The address a source is listed under, whatever address a reader came from.
 *
 * A reader from Reddit arrives from `reddit.com`, `old.reddit.com`,
 * `out.reddit.com`, `redd.it` or the Android app, and a referrer list that
 * keeps hostnames gives each its own line. This table folds the addresses a
 * well-known site goes by into the one it is known by, so the list reads as
 * sources. What is kept is still a domain, not a display name: a source the
 * table does not know is a domain already, and one kind of value stays
 * sortable, copyable and, later, filterable.
 *
 * A source has up to three kinds of entry. A family is a domain whose every
 * subdomain is this source (`m.facebook.com`, `l.facebook.com`,
 * `business.facebook.com`); a host folds to the nearest family above it. An
 * alias is one host or word that names the source under another name: a
 * short link (`t.co`), an old domain (`chat.openai.com`), the package id an
 * Android app reports when it opens a link, or a word authors and platforms
 * put in `utm_source` (`twitter`, `ig`). A pattern matches a whole host for a
 * site with a domain per country (`google.co.uk`, `pinterest.de`). Lookup
 * order is alias, pattern, family. Google has no family on purpose:
 * `mail.google.com`, `docs.google.com` and `gemini.google.com` are sources of
 * their own. A site that only ever appears under one address needs no entry.
 *
 * Which sites are worth an entry follows Plausible's source list and the
 * Snowplow referer-parser database, plus the Chinese platforms they lack.
 * Folding to a host rather than a name is this module's own choice.
 */

interface Source {
  /** The address the source is listed under. */
  readonly host: string;
  /** Domains whose every subdomain is this source. */
  readonly families?: readonly string[];
  /** Hosts, Android package ids and `utm_source` words that name this source. */
  readonly aliases?: readonly string[];
  /** Whole hosts, for a site with a domain per country. */
  readonly patterns?: readonly RegExp[];
}

const SOURCES: readonly Source[] = [
  // Social
  {
    host: "reddit.com",
    families: ["reddit.com"],
    aliases: [
      "redd.it",
      "com.reddit.frontpage",
      "com.laurencedawson.reddit_sync",
      "reddit",
    ],
  },
  {
    host: "facebook.com",
    families: ["facebook.com"],
    aliases: [
      "fb.me",
      "fb.com",
      "com.facebook.katana",
      "com.facebook.orca",
      "facebook",
      "fb",
    ],
  },
  {
    host: "instagram.com",
    families: ["instagram.com"],
    aliases: ["instagr.am", "com.instagram.android", "instagram", "ig"],
  },
  {
    host: "threads.com",
    families: ["threads.com", "threads.net"],
    aliases: ["com.instagram.barcelona", "threads"],
  },
  {
    host: "x.com",
    families: ["x.com", "twitter.com"],
    aliases: ["t.co", "com.twitter.android", "twitter", "x"],
  },
  {
    host: "youtube.com",
    families: ["youtube.com"],
    aliases: ["youtu.be", "com.google.android.youtube", "youtube", "yt"],
  },
  {
    host: "linkedin.com",
    families: ["linkedin.com"],
    aliases: ["lnkd.in", "com.linkedin.android", "linkedin"],
  },
  {
    host: "pinterest.com",
    families: ["pinterest.com"],
    aliases: ["pin.it", "com.pinterest", "pinterest"],
    patterns: [/^pinterest\.(?:co\.|com\.)?[a-z]{2}$/],
  },
  {
    host: "tiktok.com",
    families: ["tiktok.com"],
    aliases: ["com.zhiliaoapp.musically", "tiktok"],
  },
  {
    host: "bsky.app",
    families: ["bsky.app"],
    aliases: ["xyz.blueskyweb.app", "bluesky", "bsky"],
  },
  {
    host: "tumblr.com",
    families: ["tumblr.com"],
    aliases: ["t.umblr.com", "tumblr"],
  },
  { host: "vk.com", families: ["vk.com"], aliases: ["vkontakte.ru"] },
  { host: "medium.com", families: ["medium.com"] },
  {
    host: "wikipedia.org",
    families: ["wikipedia.org"],
    aliases: ["org.wikipedia", "wikipedia"],
  },
  {
    host: "news.ycombinator.com",
    aliases: [
      "hn.algolia.com",
      "io.github.hidroh.materialistic",
      "hackernews",
      "hn",
    ],
  },
  { host: "github.com", families: ["github.com"], aliases: ["github"] },
  { host: "disqus.com", families: ["disqus.com"], aliases: ["disq.us"] },
  { host: "quora.com", families: ["quora.com"] },

  // Messaging
  {
    host: "t.me",
    families: ["t.me", "telegram.org"],
    aliases: [
      "telegram.me",
      "org.telegram.messenger",
      "org.telegram.messenger.web",
      "org.telegram.plus",
      "telegram",
      "tg",
    ],
  },
  {
    host: "whatsapp.com",
    families: ["whatsapp.com"],
    aliases: ["wa.me", "com.whatsapp", "whatsapp"],
  },
  {
    host: "discord.com",
    families: ["discord.com", "discordapp.com"],
    aliases: ["com.discord", "discord"],
  },
  {
    host: "slack.com",
    families: ["slack.com"],
    aliases: ["com.slack", "slack"],
  },
  {
    host: "teams.microsoft.com",
    aliases: ["statics.teams.cdn.office.net", "com.microsoft.teams", "teams"],
  },

  // Search
  {
    host: "google.com",
    aliases: ["com.google.android.googlequicksearchbox", "google"],
    patterns: [/^google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/],
  },
  {
    host: "bing.com",
    families: ["bing.com"],
    aliases: ["ntp.msn.com", "cc.bingj.com", "bing"],
  },
  {
    host: "yahoo.com",
    aliases: ["yahoo"],
    patterns: [/^(?:[a-z]{2}\.)?search\.yahoo\.com$/],
  },
  {
    host: "duckduckgo.com",
    families: ["duckduckgo.com"],
    aliases: ["com.duckduckgo.mobile.android", "duckduckgo", "ddg"],
  },
  {
    host: "yandex.ru",
    aliases: ["ya.ru", "yandex"],
    patterns: [/^(?:clck\.)?yandex\.(?:ru|com|ua|by|kz|uz|tm|fr|eu|com\.tr)$/],
  },
  {
    host: "baidu.com",
    families: ["baidu.com"],
    aliases: ["com.baidu.searchbox", "baidu"],
  },
  { host: "sogou.com", families: ["sogou.com"], aliases: ["sogou"] },
  { host: "so.com", families: ["so.com"], aliases: ["so.360.cn"] },
  { host: "sm.cn", families: ["sm.cn"] },
  { host: "naver.com", families: ["naver.com"], aliases: ["naver"] },

  // AI assistants
  {
    host: "chatgpt.com",
    families: ["chatgpt.com"],
    aliases: ["chat.openai.com", "com.openai.chatgpt", "chatgpt", "openai"],
  },
  { host: "claude.ai", aliases: ["com.anthropic.claude", "claude"] },
  {
    host: "perplexity.ai",
    families: ["perplexity.ai"],
    aliases: ["pplx.ai", "ai.perplexity.app", "perplexity"],
  },
  { host: "gemini.google.com", aliases: ["gemini"] },
  { host: "copilot.microsoft.com", aliases: ["copilot.com", "copilot"] },
  { host: "grok.com", aliases: ["x.ai", "grok"] },
  { host: "deepseek.com", aliases: ["deepseek"] },

  // Chinese platforms
  {
    host: "weibo.com",
    families: ["weibo.com", "weibo.cn"],
    aliases: ["t.cn", "com.sina.weibo", "weibo"],
  },
  {
    host: "weixin.qq.com",
    families: ["weixin.qq.com"],
    aliases: ["com.tencent.mm", "wechat", "weixin"],
  },
  {
    host: "zhihu.com",
    families: ["zhihu.com"],
    aliases: ["com.zhihu.android", "zhihu"],
  },
  {
    host: "bilibili.com",
    families: ["bilibili.com"],
    aliases: ["b23.tv", "tv.danmaku.bili", "bilibili"],
  },
  {
    host: "douban.com",
    families: ["douban.com"],
    aliases: ["com.douban.frodo", "douban"],
  },
  {
    host: "xiaohongshu.com",
    families: ["xiaohongshu.com"],
    aliases: ["xhslink.com", "com.xingin.xhs", "xiaohongshu", "xhs"],
  },
  {
    host: "douyin.com",
    families: ["douyin.com"],
    aliases: ["com.ss.android.ugc.aweme", "douyin"],
  },

  // Mail and feed readers
  { host: "mail.google.com", aliases: ["com.google.android.gm", "gmail"] },
  {
    host: "outlook.com",
    aliases: [
      "mail.live.com",
      "outlook.live.com",
      "outlook.office.com",
      "outlook.office365.com",
      "com.microsoft.office.outlook",
      "outlook",
    ],
  },
  { host: "mail.yahoo.com", aliases: ["com.yahoo.mobile.client.android.mail"] },
  { host: "feedly.com", families: ["feedly.com"], aliases: ["feedly"] },
  { host: "inoreader.com", families: ["inoreader.com"] },
];

// Maps, not plain objects: a tag word like `constructor` must find nothing.
const ALIASES = new Map<string, string>();
const FAMILIES = new Map<string, string>();
const PATTERNS: Array<readonly [RegExp, string]> = [];
for (const source of SOURCES) {
  for (const alias of source.aliases ?? []) ALIASES.set(alias, source.host);
  for (const family of source.families ?? []) FAMILIES.set(family, source.host);
  for (const pattern of source.patterns ?? [])
    PATTERNS.push([pattern, source.host]);
}

/**
 * The address a source is listed under.
 *
 * @param host - A host, Android package id or tag word, already lowercased
 *   and without a leading `www.`
 * @returns The address the stats list it under, or `host` itself when the
 *   table has no entry for it
 * @example
 * ```ts
 * canonicalSource("old.reddit.com"); // "reddit.com"
 * canonicalSource("t.co"); // "x.com"
 * canonicalSource("google.co.uk"); // "google.com"
 * canonicalSource("mail.google.com"); // "mail.google.com"
 * canonicalSource("example.org"); // "example.org"
 * ```
 */
export function canonicalSource(host: string): string {
  const alias = ALIASES.get(host);
  if (alias) return alias;
  for (const [pattern, target] of PATTERNS) {
    if (pattern.test(host)) return target;
  }
  for (let rest = host; ;) {
    const family = FAMILIES.get(rest);
    if (family) return family;
    const dot = rest.indexOf(".");
    if (dot === -1) return host;
    rest = rest.slice(dot + 1);
  }
}
