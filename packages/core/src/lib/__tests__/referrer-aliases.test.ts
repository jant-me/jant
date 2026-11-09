/**
 * The alias table folds every address a source goes by into one, and leaves
 * alone what it does not know — including subdomains that are sources of
 * their own.
 */

import { describe, expect, it } from "vitest";
import { canonicalSource } from "../referrer-aliases.js";

describe("canonicalSource", () => {
  it("folds a family's subdomains into its address", () => {
    expect(canonicalSource("reddit.com")).toBe("reddit.com");
    expect(canonicalSource("old.reddit.com")).toBe("reddit.com");
    expect(canonicalSource("out.reddit.com")).toBe("reddit.com");
    expect(canonicalSource("m.facebook.com")).toBe("facebook.com");
    expect(canonicalSource("l.instagram.com")).toBe("instagram.com");
    expect(canonicalSource("en.m.wikipedia.org")).toBe("wikipedia.org");
    expect(canonicalSource("mp.weixin.qq.com")).toBe("weixin.qq.com");
    expect(canonicalSource("zhuanlan.zhihu.com")).toBe("zhihu.com");
    expect(canonicalSource("cn.bing.com")).toBe("bing.com");
  });

  it("folds a family that moved or was renamed into the current address", () => {
    expect(canonicalSource("twitter.com")).toBe("x.com");
    expect(canonicalSource("mobile.twitter.com")).toBe("x.com");
    expect(canonicalSource("threads.net")).toBe("threads.com");
    expect(canonicalSource("web.telegram.org")).toBe("t.me");
    expect(canonicalSource("m.weibo.cn")).toBe("weibo.com");
    expect(canonicalSource("ptb.discordapp.com")).toBe("discord.com");
  });

  it("folds short links and old domains", () => {
    expect(canonicalSource("t.co")).toBe("x.com");
    expect(canonicalSource("redd.it")).toBe("reddit.com");
    expect(canonicalSource("youtu.be")).toBe("youtube.com");
    expect(canonicalSource("lnkd.in")).toBe("linkedin.com");
    expect(canonicalSource("chat.openai.com")).toBe("chatgpt.com");
    expect(canonicalSource("hn.algolia.com")).toBe("news.ycombinator.com");
    expect(canonicalSource("outlook.live.com")).toBe("outlook.com");
    expect(canonicalSource("b23.tv")).toBe("bilibili.com");
    expect(canonicalSource("t.cn")).toBe("weibo.com");
  });

  it("folds a site's country domains", () => {
    expect(canonicalSource("google.com")).toBe("google.com");
    expect(canonicalSource("google.co.uk")).toBe("google.com");
    expect(canonicalSource("google.com.hk")).toBe("google.com");
    expect(canonicalSource("google.de")).toBe("google.com");
    expect(canonicalSource("google.cat")).toBe("google.com");
    expect(canonicalSource("uk.search.yahoo.com")).toBe("yahoo.com");
    expect(canonicalSource("search.yahoo.com")).toBe("yahoo.com");
    expect(canonicalSource("pinterest.de")).toBe("pinterest.com");
    expect(canonicalSource("pinterest.co.uk")).toBe("pinterest.com");
    expect(canonicalSource("clck.yandex.ru")).toBe("yandex.ru");
  });

  it("keeps a subdomain that is a source of its own", () => {
    expect(canonicalSource("mail.google.com")).toBe("mail.google.com");
    expect(canonicalSource("docs.google.com")).toBe("docs.google.com");
    expect(canonicalSource("news.google.com")).toBe("news.google.com");
    expect(canonicalSource("gemini.google.com")).toBe("gemini.google.com");
    expect(canonicalSource("news.yahoo.com")).toBe("news.yahoo.com");
    expect(canonicalSource("mail.qq.com")).toBe("mail.qq.com");
    expect(canonicalSource("someone.substack.com")).toBe(
      "someone.substack.com",
    );
    expect(canonicalSource("someone.github.io")).toBe("someone.github.io");
  });

  it("folds the Android app a link was opened from into its site", () => {
    expect(canonicalSource("com.google.android.googlequicksearchbox")).toBe(
      "google.com",
    );
    expect(canonicalSource("com.reddit.frontpage")).toBe("reddit.com");
    expect(canonicalSource("org.telegram.messenger")).toBe("t.me");
    expect(canonicalSource("com.google.android.gm")).toBe("mail.google.com");
    expect(canonicalSource("com.tencent.mm")).toBe("weixin.qq.com");
    expect(canonicalSource("com.example.app")).toBe("com.example.app");
  });

  it("folds the words links get tagged with", () => {
    expect(canonicalSource("twitter")).toBe("x.com");
    expect(canonicalSource("ig")).toBe("instagram.com");
    expect(canonicalSource("yt")).toBe("youtube.com");
    expect(canonicalSource("hn")).toBe("news.ycombinator.com");
    expect(canonicalSource("wechat")).toBe("weixin.qq.com");
    expect(canonicalSource("chatgpt")).toBe("chatgpt.com");
    expect(canonicalSource("newsletter")).toBe("newsletter");
  });

  it("leaves what it does not know alone", () => {
    expect(canonicalSource("example.org")).toBe("example.org");
    expect(canonicalSource("blog.example.org")).toBe("blog.example.org");
    expect(canonicalSource("mastodon.social")).toBe("mastodon.social");
    expect(canonicalSource("constructor")).toBe("constructor");
    expect(canonicalSource("__proto__")).toBe("__proto__");
    expect(canonicalSource("")).toBe("");
  });
});
