// F3 对话栏与输入框用的图标（自绘 SVG，线宽 1.75，跟随 currentColor）。
import type { ReactNode, SVGProps } from 'react';

type P = { size?: number; className?: string } & Omit<SVGProps<SVGSVGElement>, 'children'>;

function Svg({ size = 16, className, children, ...rest }: P & { children: ReactNode }) {
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
      {...rest}
    >
      {children}
    </svg>
  );
}

export const LayersIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4 3.5 8.3 12 12.6l8.5-4.3L12 4Z" />
    <path d="m3.5 12.2 8.5 4.3 8.5-4.3M3.5 16l8.5 4.3 8.5-4.3" />
  </Svg>
);

export const SparkleIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5c.6 4.4 3.9 7.8 8.5 8.5-4.6.7-7.9 4.1-8.5 8.5-.6-4.4-3.9-7.8-8.5-8.5 4.6-.7 7.9-4.1 8.5-8.5Z" />
  </Svg>
);

export const ArrowUpIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);

/** 停止：实心圆角方块 */
export const StopIcon = ({ size = 16, className }: { size?: number; className?: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={`flex-none ${className ?? ''}`}>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
  </svg>
);

export const ChevronIcon = ({ dir = 'right', ...p }: P & { dir?: 'right' | 'left' | 'down' | 'up' }) => {
  const d = { right: 'm9 6 6 6-6 6', left: 'm15 6-6 6 6 6', down: 'm6 9 6 6 6-6', up: 'm6 15 6-6 6 6' }[dir];
  return (
    <Svg {...p}>
      <path d={d} />
    </Svg>
  );
};

export const CopyIcon = (p: P) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </Svg>
);

export const RegenerateIcon = (p: P) => (
  <Svg {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </Svg>
);

export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const AlertIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4 2.8 19.5h18.4L12 4Z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </Svg>
);

export const ArrowDownIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);

/** 历史对话来源卡的小图标 */
export const BubbleIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 5.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
  </Svg>
);

/** 步骤明细的状态点 */
export const DotIcon = ({ size = 8, className }: { size?: number; className?: string }) => (
  <svg viewBox="0 0 8 8" width={size} height={size} aria-hidden="true" className={`flex-none ${className ?? ''}`}>
    <circle cx="4" cy="4" r="3" fill="currentColor" />
  </svg>
);
