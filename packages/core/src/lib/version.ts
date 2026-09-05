/**
 * Version and build asset paths
 *
 * `__JANT_VERSION__` is replaced by Vite's `define` during both dev and lib build.
 *
 * `__CLIENT_JS_FILE__` and `__CLIENT_AUTH_JS_FILE__` are content-addressed
 * internal paths (e.g. `/_assets/client-HASH.js`) embedded by the Worker build
 * from the Vite client manifest. Used only in production (IS_VITE_DEV=false).
 * `__CLIENT_COMPOSE_PRELOAD__` lists every file the composer entry needs —
 * the entry and the chunks it imports — for the layout's modulepreload links.
 *
 * The dev flag itself lives in `build-env.ts`, which client bundles can import
 * without these Worker-only globals.
 */

declare const __JANT_VERSION__: string;
declare const __CLIENT_JS_FILE__: string;
declare const __CLIENT_AUTH_JS_FILE__: string;
declare const __CLIENT_COMPOSE_PRELOAD__: readonly string[];
declare const __CLIENT_CSS_FILE__: string;
declare const __CLIENT_AUTHOR_CSS_FILE__: string;
declare const __CLIENT_CJK_CSS_FILE__: string;
declare const __CLIENT_CJK_TC_CSS_FILE__: string;
declare const __CLIENT_CJK_JP_CSS_FILE__: string;
declare const __CLIENT_CJK_KR_CSS_FILE__: string;

export const CORE_VERSION = __JANT_VERSION__;
export const CLIENT_JS_FILE = __CLIENT_JS_FILE__;
export const CLIENT_AUTH_JS_FILE = __CLIENT_AUTH_JS_FILE__;
export const CLIENT_COMPOSE_PRELOAD = __CLIENT_COMPOSE_PRELOAD__;
export const CLIENT_CSS_FILE = __CLIENT_CSS_FILE__;
export const CLIENT_AUTHOR_CSS_FILE = __CLIENT_AUTHOR_CSS_FILE__;
export const CLIENT_CJK_CSS_FILE = __CLIENT_CJK_CSS_FILE__;
export const CLIENT_CJK_TC_CSS_FILE = __CLIENT_CJK_TC_CSS_FILE__;
export const CLIENT_CJK_JP_CSS_FILE = __CLIENT_CJK_JP_CSS_FILE__;
export const CLIENT_CJK_KR_CSS_FILE = __CLIENT_CJK_KR_CSS_FILE__;
