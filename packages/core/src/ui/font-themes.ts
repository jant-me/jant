/**
 * Built-in Font Themes
 *
 * System-font-only presets — no external font loading required.
 */

/**
 * A font theme definition with display metadata.
 */
export interface FontTheme {
  /** Stored in DB settings, e.g. "serif" */
  id: string;
  /** Display name, e.g. "Serif" */
  name: string;
  /** CSS font-family stack */
  fontFamily: string;
  /** Short description for the picker UI */
  description: string;
}

export const BUILTIN_FONT_THEMES: FontTheme[] = [
  {
    id: "default",
    name: "System Default",
    // 现代系统字体栈：先英文，后 Mac/iOS 中文，再 Win 中文
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans CN", sans-serif',
    description: "与你的操作系统保持一致，最稳定的阅读体验",
  },
  {
    id: "serif",
    name: "Classic Serif",
    // Charter 是 Apple 系统自带的极品衬线体
    fontFamily:
      'Charter, "Bitstream Charter", "Sitka Text", Georgia, "Songti SC", "Source Han Serif CN", "STSong", "SimSun", serif',
    description: "传统的衬线体，适合深度长文阅读",
  },
  {
    id: "humanist",
    name: "Humanist",
    // Optima 具有书法韵味，Candara 是 Windows 上的优质人文体
    fontFamily:
      'Optima, Candara, "Noto Sans", "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    description: "温润如玉的字体风格，兼具现代感与书法美感",
  },
  {
    id: "mono",
    name: "Monospace",
    // 优先使用 JetBrains Mono 或 SF Mono
    fontFamily:
      '"JetBrains Mono", "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", "PingFang SC", "Microsoft YaHei", monospace',
    description: "等宽字体，适合技术内容或代码展示",
  },
];
