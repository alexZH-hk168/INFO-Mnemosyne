// F5 图标：自绘 SVG（docs/DEVELOPMENT.md「图标自绘 SVG 放 web/src/icons/」）。
type P = { size?: number; className?: string };

/** 合并：两条线汇到一条（“要点合并到主线”） */
export const MergeIcon = ({ size = 16, className }: P) => (
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
    <circle cx="6.5" cy="5.5" r="2.2" />
    <circle cx="17.5" cy="18.5" r="2.2" />
    <path d="M6.5 7.7V20" />
    <path d="M6.5 9.5c0 5 4 9 8.8 9" />
  </svg>
);

/** 引号（来源原句块） */
export const QuoteIcon = ({ size = 14, className }: P) => (
  <svg
    viewBox="0 0 16 16"
    width={size}
    height={size}
    aria-hidden="true"
    className={`flex-none ${className ?? ''}`}
    fill="currentColor"
  >
    <path d="M3 9.5C3 7 4.3 5.2 6.6 4.5l.4.9C5.6 6 5 7 5 8h1.6c.5 0 .9.4.9.9v2.2c0 .5-.4.9-.9.9H3.9a.9.9 0 0 1-.9-.9V9.5Zm5.5 0c0-2.5 1.3-4.3 3.6-5l.4.9c-1.4.6-2 1.6-2 2.6h1.6c.5 0 .9.4.9.9v2.2c0 .5-.4.9-.9.9H9.4a.9.9 0 0 1-.9-.9V9.5Z" />
  </svg>
);
