// 代码高亮：Shiki（MIT）的精简核心 + JS 正则引擎（不加载 wasm），语言包与主题按需懒加载。
// 只给出逐行 token（颜色），渲染与行号由 CodeViewer 负责。
import type { HighlighterCore, ThemedToken } from 'shiki/core';

const LANG_BY_EXT: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  sh: 'shellscript',
  bash: 'shellscript',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  java: 'java',
  go: 'go',
  rs: 'rust',
  r: 'r',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  html: 'html',
  css: 'css',
  md: 'markdown',
};

const LOADERS: Record<string, () => Promise<unknown>> = {
  python: () => import('shiki/langs/python.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
};

export const THEME = 'github-light';

/** 按文件名后缀判断语言；认不出时为 null（按纯文本显示） */
export function langOf(filename: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return (m && LANG_BY_EXT[m[1].toLowerCase()]) ?? null;
}

let core: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();

async function highlighter(): Promise<HighlighterCore> {
  if (!core) {
    core = Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/github-light.mjs'),
    ]).then(([c, e, theme]) =>
      c.createHighlighterCore({
        themes: [(theme as { default: never }).default],
        langs: [],
        engine: e.createJavaScriptRegexEngine(),
      }),
    );
  }
  return core;
}

/** 逐行 token；语言不支持时返回 null */
export async function tokenize(code: string, lang: string | null): Promise<ThemedToken[][] | null> {
  if (!lang || !LOADERS[lang]) return null;
  const h = await highlighter();
  if (!loaded.has(lang)) {
    const mod = (await LOADERS[lang]()) as { default: never };
    await h.loadLanguage(mod.default);
    loaded.add(lang);
  }
  return h.codeToTokensBase(code, { lang, theme: THEME });
}
