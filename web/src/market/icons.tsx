// F6 自绘图标（UI-07～10 用到、web/src/icons/Icons.tsx 里还没有的几个）。
// 只在 web/src/market、web/src/settings 内使用；合并后可由编排移到 web/src/icons/。
import type { ReactNode } from 'react';

function Svg({ size = 14, children, strokeWidth = 1.8 }: { size?: number; children: ReactNode; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="flex-none"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

export const StarIcon = ({ size = 12 }: P) => (
  <Svg size={size}>
    <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
  </Svg>
);
export const CheckIcon = ({ size = 14 }: P) => (
  <Svg size={size} strokeWidth={2}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const SearchIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Svg>
);
export const ChevronDown = ({ size = 12 }: P) => (
  <Svg size={size}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
export const ChevronRight = ({ size = 12 }: P) => (
  <Svg size={size}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const BookIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M4 5.5A1.5 1.5 0 015.5 4H11v15H5.5A1.5 1.5 0 014 17.5z" />
    <path d="M20 5.5A1.5 1.5 0 0018.5 4H13v15h5.5a1.5 1.5 0 001.5-1.5z" />
  </Svg>
);
export const LayersIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M12 4l8 4.5-8 4.5-8-4.5z" />
    <path d="M4 13l8 4.5 8-4.5" />
  </Svg>
);
export const SparkIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M12 3.5l1.8 6.7 6.7 1.8-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8z" />
  </Svg>
);
export const FileIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M7 3.5h7l4 4v13H7z" />
    <path d="M14 3.5v4h4" />
  </Svg>
);
export const ImportIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M12 4v11" />
    <path d="M7.5 10.5L12 15l4.5-4.5" />
    <path d="M5 19.5h14" />
  </Svg>
);
export const AlertIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5" />
    <path d="M12 16.3v.2" />
  </Svg>
);
export const TrashIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M5 7h14" />
    <path d="M9.5 7V4.5h5V7" />
    <path d="M7 7l.8 12.5h8.4L17 7" />
  </Svg>
);
export const EditIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M14.5 5.5l4 4L9 19H5v-4z" />
  </Svg>
);
