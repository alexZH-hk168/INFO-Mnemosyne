// F4 图标（自绘 SVG，docs/DEVELOPMENT.md「图标自绘 SVG 放 web/src/icons/」）：PDF 工具条、标签条“更多”、外部链接。
import type { ReactNode } from 'react';

type P = { size?: number; className?: string };

function Svg({ size = 16, className, children }: P & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`flex-none ${className ?? ''}`}
    >
      {children}
    </svg>
  );
}

export const ZoomInIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4M8.5 11h5M11 8.5v5" />
  </Svg>
);

export const ZoomOutIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4M8.5 11h5" />
  </Svg>
);

export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Svg>
);

export const DownloadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </Svg>
);

export const MoreIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="12" r="0.9" fill="currentColor" />
    <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    <circle cx="18" cy="12" r="0.9" fill="currentColor" />
  </Svg>
);

export const ExternalIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 5h5v5M19 5l-8 8M17 14v4.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H10" />
  </Svg>
);
