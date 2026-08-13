/**
 * Content language detection.
 *
 * A hand-written character-set voter, not a statistical model. It runs in the
 * browser (in compose, for logged-in authors only — public pages load none of
 * it) and on the server (for posts that arrive through the API, the Telegram
 * bot, or MCP, where nobody picked a language).
 *
 * What it is good at, and what it is not:
 *
 * - Hangul and kana are near-unambiguous, so Korean and Japanese are reliable.
 * - Simplified vs Traditional Chinese is decided by voting on characters that
 *   exist in only one of the two. One sentence is usually plenty; a handful of
 *   shared Han characters is not, and that case deliberately falls back.
 * - Latin script says "not CJK", nothing more. It resolves to a language only
 *   when the site publishes exactly one non-CJK language.
 * - Nothing at all is read out of a fragment. See `MIN_SIGNAL`: under a couple
 *   of words the honest answer is the caller's default, not a coin toss that
 *   changes with the next keystroke.
 *
 * The detector **never** returns an empty value or a language the site does
 * not publish: it always answers with a member of `languages`, falling back to
 * the caller's default. Its output is a *suggestion* the author can change —
 * nothing here decides anything irreversibly.
 */

import { getCjkFontFromLanguageTag } from "../i18n/detect.js";

/**
 * Characters written only in Simplified Chinese.
 *
 * Every entry is checked to be absent from Traditional writing — a character
 * that serves both (`后` as "empress", `台` in `台北`) would vote for the wrong
 * side and has been left out, while its Traditional counterpart still votes.
 */
const SIMPLIFIED_ONLY =
  "们这会说对时国学个来过现发经应关点无义与从门问间东车长马鸟鱼见贝页风飞头语话认识讲论议记让试该请读谁调谈变边达运还进远连" +
  "适选递邮释钟银错锁闭开闻阅队阶阳阴陆陈险隐难静韩须顾频颜题类飘饭饮饰馆驻驾验骑骗体处备够夺奋妇妈宁宝实宽宾寻导尔尘尝尽层" +
  "属岁岂岛币帅帮归当录彻忆态怀恋恶悬惊惧惨愤愿战户扩扫扬担拟挂挤挥换据摄击敌断旧显术机杀杂权条极构柜标树桥检楼欢欧残毁气汉" +
  "汤沟泪洁济浏浅浆涛润涨渐渔渗湾湿满滨滤灭灯灵灾炉烦烧热营爱状犹狮独狱猎猪献猫环电画畅疗疯皱监盘矿码确础礼祸种积称稳穷窃竞" +
  "笔筹简签粮紧纪纯纲纳纵纷纸线组细织终绍结绕绘给络绝统继绩绪续维综绿缓编缘缩缴网罗罚罢习联声职聪肃肠胀脑脱腊舰艰节苏药荐荡" +
  "获萧蓝虏虚虽蚀蜡补装观规觉计订讨训讯词译诉诊证评诚误诸课谅谓谢谱贡财责贤败货质贩贪购贯贱贴贵贷贸费贺资赏赐赔赖赚赛赢赠赶" +
  "趋践轨转轮软载较辅辈辉输辐辑辞迁迈违迟逊遗邓邻郑针钉钓钙钝钞钢钥钦钩钱钻铁铃铅铜铝铺链销锋锐锦键镇镜闪闯闲闷闹阀阁阵际隶" +
  "随雾项顶预领颇颈颗颠饥饱饼馈驰驱驶骂骄鲁鲜鸡鸣鸦鸭鸽鹅鹰麦黄齐齿龄龙龟儿优传伤侦侧俭债倾偿储兰兴军农决净减凤凭则刘创剑剧" +
  "劝办务动励劳势勋医华单卖卫厅历压厌厨参叶号叹吗启呐员呜响哑唤啸喷嘱团园围图圆场坏块坚坛垒垦堕墙壮壳复";

/** Characters written only in Traditional Chinese. */
const TRADITIONAL_ONLY =
  "們這會說對時國學後個來過現發經應關點無義與從門問間東車長馬鳥魚見貝頁風飛頭語話認識講論議記讓試該請讀誰調談變邊達運還進遠" +
  "連適選遞郵釋鐘銀錯鎖閉開聞閱隊階陽陰陸陳險隱難靜韓須顧頻顏題類飄飯飲飾館駐駕驗騎騙體處備夠奪奮婦媽寧寶實寬賓尋導爾塵嘗盡" +
  "層屬歲豈島幣帥幫歸當錄徹憶態懷戀惡懸驚懼慘憤願戰戶擴掃揚擔擬掛擠揮換據攝擊敵斷舊顯術機殺雜權條極構櫃標樹橋檢樓歡歐殘毀氣" +
  "漢湯溝淚潔濟瀏淺漿濤潤漲漸漁滲灣濕滿濱濾滅燈靈災爐煩燒熱營愛狀猶獅獨獄獵豬獻貓環電畫暢療瘋皺監盤礦碼確礎禮禍種積稱穩窮竊" +
  "競筆籌簡簽糧緊紀純綱納縱紛紙線組細織終紹結繞繪給絡絕統繼績緒續維綜綠緩編緣縮繳網羅罰罷習聯聲職聰肅腸脹腦脫臘艦艱節蘇藥薦" +
  "蕩獲蕭藍虜虛雖蝕蠟補裝觀規覺計訂討訓訊詞譯訴診證評誠誤諸課諒謂謝譜貢財責賢敗貨質販貪購貫賤貼貴貸貿費賀資賞賜賠賴賺賽贏贈" +
  "趕趨踐軌轉輪軟載較輔輩輝輸輻輯辭遷邁違遲遜遺鄧鄰鄭針釘釣鈣鈍鈔鋼鑰欽鉤錢鑽鐵鈴鉛銅鋁鋪鏈銷鋒銳錦鍵鎮鏡閃闖閒悶鬧閥閣陣際" +
  "隸隨霧項頂預領頗頸顆顛飢飽餅饋馳驅駛罵驕魯鮮雞鳴鴉鴨鴿鵝鷹麥黃齊齒齡龍龜兒優傳傷偵側儉債傾償儲蘭興軍農衝決淨減鳳憑劃則劉" +
  "創劍劇勸辦務動勵勞勢勳醫華單賣衛廳歷壓厭廚參疊隻臺葉號嘆嗎啟吶員嗚響啞喚嘯噴囑團園圍圖圓場壞塊堅壇壘墾墮牆壯殼複";

const SIMPLIFIED_SET = new Set(SIMPLIFIED_ONLY);
const TRADITIONAL_SET = new Set(TRADITIONAL_ONLY);

/** Script family a run of text is written in, before it meets the site's languages. */
export type DetectedScript = "ko" | "ja" | "zh-Hans" | "zh-Hant" | "latin";

interface ScriptCounts {
  hangul: number;
  kana: number;
  han: number;
  latin: number;
  simplified: number;
  traditional: number;
}

function countScripts(text: string): ScriptCounts {
  const counts: ScriptCounts = {
    hangul: 0,
    kana: 0,
    han: 0,
    latin: 0,
    simplified: 0,
    traditional: 0,
  };

  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;

    // Hangul syllables, Jamo, and compatibility Jamo.
    if (
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x3130 && code <= 0x318f)
    ) {
      counts.hangul++;
      continue;
    }

    // Hiragana, katakana, and katakana phonetic extensions.
    if (
      (code >= 0x3040 && code <= 0x309f) ||
      (code >= 0x30a0 && code <= 0x30ff) ||
      (code >= 0x31f0 && code <= 0x31ff)
    ) {
      counts.kana++;
      continue;
    }

    // CJK Unified Ideographs, Extension A, and compatibility ideographs.
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      counts.han++;
      if (SIMPLIFIED_SET.has(char)) counts.simplified++;
      else if (TRADITIONAL_SET.has(char)) counts.traditional++;
      continue;
    }

    // Basic Latin letters plus the Latin-1 and Extended-A accented ranges.
    if (
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0xc0 && code <= 0x24f)
    ) {
      counts.latin++;
    }
  }

  return counts;
}

/**
 * What a CJK character is worth against a Latin letter.
 *
 * A Han character is closer to a word than to a letter, and kana and Hangul
 * sit in between — so counting characters straight would let a two-character
 * quote outvote a paragraph. Three is the rough density ratio between CJK and
 * Latin text, and it is the only number here that has to be approximate: it
 * decides ties between scripts, not what any one script means.
 */
const CJK_WEIGHT = 3;

/**
 * How much evidence it takes before the detector will name a script at all.
 *
 * Ten points is four Han characters, or two English words. Below that the
 * answer would swing on every keystroke — a composer that reads "H" as English
 * and "He 说" as Chinese is not reading, it is twitching. Under the threshold
 * the detector refuses and the caller keeps its own default, which is the
 * language of the page the author is writing from.
 */
const MIN_SIGNAL = 10;

/**
 * Identify the script family a piece of text is written in.
 *
 * Exported for its own sake — the language-set resolution below is a separate
 * concern, and testing the two apart keeps both honest.
 *
 * @param text - Plain text, typically a post body
 * @returns The script family, or null when the text carries too little signal
 * @example
 * detectScript("これはテスト"); // "ja"
 * detectScript("國學說這時"); // "zh-Hant"
 * detectScript("Hi"); // null — too short to be worth an answer
 * detectScript("123 !!!"); // null
 */
export function detectScript(text: string): DetectedScript | null {
  const counts = countScripts(text);
  const cjk = (counts.hangul + counts.kana + counts.han) * CJK_WEIGHT;

  // Which script the text is *mostly* in, not merely which one appears in it:
  // an English paragraph that quotes a Chinese phrase is still English, and
  // before this comparison a single Han character spoke for the whole post.
  if (cjk >= counts.latin && cjk >= MIN_SIGNAL) {
    // Korean mixes Hangul with Han; Japanese mixes kana with Han. Neither
    // borrows the other's syllabary, so either one present settles it.
    if (counts.hangul > 0) return "ko";
    if (counts.kana > 0) return "ja";
    if (counts.simplified > counts.traditional) return "zh-Hans";
    if (counts.traditional > counts.simplified) return "zh-Hant";
    // Han with no distinctive character either way — a phrase written
    // identically in both. Refuse to guess.
    return null;
  }

  return counts.latin >= MIN_SIGNAL ? "latin" : null;
}

/**
 * Read one of the site's languages out of a piece of text, or admit that the
 * text does not say.
 *
 * The distinction is the whole point of this function existing next to
 * `detectContentLanguage`: a caller that substitutes a default cannot tell
 * "this is English" from "I could not tell, here is your default", and a
 * composer that reports the second as the first is lying to the author.
 *
 * @param text - Plain text, typically a post body
 * @param options - The languages the site publishes
 * @returns A tag from `options.languages`, or null when the text does not
 *   settle on one of them
 * @example
 * readContentLanguage("國學說這時會對後", {
 *   languages: ["zh-Hans", "zh-Hant", "en"],
 * }); // "zh-Hant"
 * readContentLanguage("Hi", { languages: ["zh-Hans", "en"] }); // null
 */
export function readContentLanguage(
  text: string,
  options: { languages: readonly string[] },
): string | null {
  const { languages } = options;
  if (languages.length === 0) return null;

  const script = detectScript(text);
  if (!script) return null;

  if (script === "latin") {
    // Latin script only says "not CJK". That names a language only when there
    // is exactly one candidate; with English and French configured, guessing
    // between them from the alphabet alone would be a coin toss.
    const nonCjk = languages.filter((tag) => !getCjkFontFromLanguageTag(tag));
    return nonCjk.length === 1 ? (nonCjk[0] as string) : null;
  }

  // No match means the site does not publish the detected script — say nothing
  // rather than invent a language the author never configured.
  return (
    languages.find((tag) => getCjkFontFromLanguageTag(tag) === script) ?? null
  );
}

/**
 * Suggest which of the site's languages a piece of text is written in.
 *
 * @param text - Plain text, typically a post body
 * @param options - The languages the site publishes, and what to answer when
 *   the text gives no usable signal
 * @returns A tag from `options.languages`, always
 * @example
 * detectContentLanguage("國學說這時會對後", {
 *   languages: ["zh-Hans", "zh-Hant", "en"],
 *   fallback: "zh-Hans",
 * }); // "zh-Hant"
 */
export function detectContentLanguage(
  text: string,
  options: { languages: readonly string[]; fallback: string },
): string {
  return readContentLanguage(text, options) ?? options.fallback;
}

/**
 * Suggest the language a new Post should be stored with, when nobody said.
 *
 * Only ever fills a blank: an explicit choice is the author's and is never
 * second-guessed here. Returns null on a site that does not publish more than
 * one language, because nothing is stamped before the feature is turned on.
 *
 * @param options - Text to read, the site's languages, and its primary one
 * @returns Canonical tag from `languages`, or null when the site is single-language
 * @example
 * suggestPostLanguage({
 *   text: "Hello there",
 *   languages: ["zh-Hans", "en"],
 *   primary: "zh-Hans",
 * }); // "en"
 */
export function suggestPostLanguage(options: {
  text?: string | null;
  languages: readonly string[];
  primary: string;
}): string | null {
  const { text, languages, primary } = options;

  if (languages.length === 0) return null;
  if (!text?.trim()) return primary;

  return detectContentLanguage(text, { languages, fallback: primary });
}
