import type { Config } from 'tailwindcss';

// 颜色、圆角、字体全部指向 src/styles/tokens.css 的 CSS 变量；不在这里写死色值。
const v = (name: string) => `var(--${name})`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // 覆盖默认调色板：组件只能用 token 颜色
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      canvas: v('canvas'),
      panel: { DEFAULT: v('panel'), 2: v('panel-2') },
      surface: v('surface'),
      line: { DEFAULT: v('line'), 2: v('line-2') },
      ink: { DEFAULT: v('ink'), 2: v('ink-2') },
      muted: v('muted'),
      faint: v('faint'),
      sel: v('sel'),
      evi: {
        bg: v('evi-bg'),
        ink: v('evi-ink'),
        hl: v('evi-hl'),
        ring: v('evi-ring'),
        'web-bg': v('evi-web-bg'),
        'web-ink': v('evi-web-ink'),
        'msg-bg': v('evi-msg-bg'),
        'msg-ink': v('evi-msg-ink'),
      },
      ok: v('ok'),
      // F1 追加
      ft: { pdf: v('ft-pdf'), pptx: v('ft-pptx'), code: v('ft-code'), ipynb: v('ft-ipynb'), md: v('ft-md') },
      handle: v('handle'),
      avatar: v('avatar'),
      'drop-line': v('drop-line'),
      danger: v('danger'),
      scrim: v('scrim'),
    },
    fontFamily: {
      sans: v('font-sans'),
      serif: v('font-serif'),
      mono: v('font-mono'),
    },
    borderRadius: {
      none: '0',
      panel: v('radius-panel'),
      card: v('radius-card'),
      'card-sm': v('radius-card-sm'),
      btn: v('radius-btn'),
      'btn-sm': v('radius-btn-sm'),
      chip: v('radius-chip'),
      pill: v('radius-pill'),
    },
    extend: {},
  },
  plugins: [],
} satisfies Config;
