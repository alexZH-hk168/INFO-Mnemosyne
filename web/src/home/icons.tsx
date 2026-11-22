// 封面与弹窗共用的小图标（自绘 SVG，线宽 1.6，跟随 currentColor）。
// DEVELOPMENT.md 建议图标放 web/src/icons/；F2 文件边界限定在 home/ 内，合并时可由编排 Agent 挪过去。
import type { SVGProps } from 'react';

export type IconName =
  'globe' | 'layers' | 'puzzle' | 'plus' | 'sparkle' | 'arrow-up' | 'x' | 'branch' | 'book' | 'history';

const PATHS: Record<IconName, JSX.Element> = {
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5M12 3.5C9.6 5.8 8.4 8.6 8.4 12s1.2 6.2 3.6 8.5" />
    </>
  ),
  layers: (
    <>
      <path d="M12 4 3.5 8.3 12 12.6l8.5-4.3L12 4Z" />
      <path d="m3.5 12.2 8.5 4.3 8.5-4.3M3.5 16l8.5 4.3 8.5-4.3" />
    </>
  ),
  puzzle: (
    <path d="M9 4.5a2 2 0 0 1 4 0V6h3.5a1 1 0 0 1 1 1v3.5H19a2 2 0 0 1 0 4h-1.5V18a1 1 0 0 1-1 1H13v-1.5a2 2 0 0 0-4 0V19H5.5a1 1 0 0 1-1-1v-3.5H6a2 2 0 0 0 0-4H4.5V7a1 1 0 0 1 1-1H9V4.5Z" />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  sparkle: (
    <path d="M12 3.5c.6 4.4 3.9 7.8 8.5 8.5-4.6.7-7.9 4.1-8.5 8.5-.6-4.4-3.9-7.8-8.5-8.5 4.6-.7 7.9-4.1 8.5-8.5Z" />
  ),
  'arrow-up': <path d="M12 19V5M6 11l6-6 6 6" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  branch: (
    <>
      <circle cx="7" cy="5.5" r="2" />
      <circle cx="7" cy="18.5" r="2" />
      <circle cx="17" cy="8" r="2" />
      <path d="M7 7.5v9M17 10c0 4-4 4.5-8.6 7.2" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.5C10 5.2 7.2 4.8 4 5v13c3.2-.2 6 .2 8 1.5 2-1.3 4.8-1.7 8-1.5V5c-3.2-.2-6 .2-8 1.5Z" />
      <path d="M12 6.5v13" />
    </>
  ),
  history: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
      <path d="M4.5 4.5V9H9M12 8v4.2l2.8 1.8" />
    </>
  ),
};

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
