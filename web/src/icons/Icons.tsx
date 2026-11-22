// 图标：全部自绘（docs/DEVELOPMENT.md「图标自绘 SVG 放 web/src/icons/」）。
// 收起图标用独立文件 panelL.svg / panelR.svg（规格 1-外壳-栏收起按钮），其余图标在这里用 TSX 画。
import type { ReactNode, SVGProps } from 'react';
import panelLRaw from './panelL.svg?raw';
import panelRRaw from './panelR.svg?raw';

type IconProps = { size?: number; className?: string; title?: string } & Omit<SVGProps<SVGSVGElement>, 'children'>;

function Svg({ size = 16, className, children, ...rest }: IconProps & { children: ReactNode }) {
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

/** 收起图标：圆角面板 + 竖分隔线 + 两条短线；side=right 为右栏镜像版 */
export function PanelIcon({ side = 'left', size = 18 }: { side?: 'left' | 'right'; size?: number }) {
  const raw = side === 'left' ? panelLRaw : panelRRaw;
  return (
    <span
      aria-hidden="true"
      data-icon={side === 'left' ? 'panelL' : 'panelR'}
      className="inline-flex flex-none [&>svg]:h-full [&>svg]:w-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: raw }}
    />
  );
}

/** 品牌标记：主干两点 + 一条分叉 */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true" className="flex-none">
      <g stroke="var(--ink)" strokeWidth={1.8} strokeLinecap="round">
        <circle cx="6.5" cy="5.5" r="2.1" />
        <circle cx="6.5" cy="18.5" r="2.1" />
        <circle cx="17.5" cy="8.5" r="2.1" />
        <path d="M6.5 7.6v8.8" />
        <path d="M17.5 10.6c0 3.9-4.2 4.6-9.2 6.4" />
      </g>
      <path d="M15.4 8.5h-4.6" stroke="var(--evi-ink)" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

export const ComposeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11.5 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" />
    <path d="M17.8 3.7a1.6 1.6 0 0 1 2.3 2.3l-7.9 7.9-3.2.9.9-3.2z" />
  </Svg>
);

export const PuzzleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 5.5h4V5a2 2 0 1 1 4 0v.5h4.5a1 1 0 0 1 1 1V11H18a2 2 0 1 0 0 4h.5v3.5a1 1 0 0 1-1 1H13V19a2 2 0 1 0-4 0v.5H5a1 1 0 0 1-1-1V15h.5a2 2 0 1 0 0-4H4V6.5a1 1 0 0 1 1-1z" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5.5v13" />
    <path d="M5.5 12h13" />
  </Svg>
);

export const FolderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.4H19a1.5 1.5 0 0 1 1.5 1.5v9.1A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />
  </Svg>
);

export const FolderOpenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 17.5V6.5A1.5 1.5 0 0 1 5 5h4.2l2 2.4H17a1.5 1.5 0 0 1 1.5 1.5v1.6" />
    <path d="M3.5 18.2 6 11.9a1.5 1.5 0 0 1 1.4-.9h12.9a1 1 0 0 1 .94 1.34l-2.3 6.2a1.5 1.5 0 0 1-1.4 1H4.9a1.4 1.4 0 0 1-1.4-1.34z" />
  </Svg>
);

export const MessageIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5a2 2 0 0 1-2 2H8.5L4 20V6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
  </Svg>
);

export const BranchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6.5" cy="5.5" r="2.2" />
    <circle cx="6.5" cy="18.5" r="2.2" />
    <circle cx="17.5" cy="7" r="2.2" />
    <path d="M6.5 7.7v8.6" />
    <path d="M17.5 9.2c0 4.6-4.4 6.8-9 7.6" />
  </Svg>
);

/** 齿轮：8 齿，按极坐标生成 */
const gearPath = (() => {
  const pts: string[] = [];
  const teeth = 8;
  for (let i = 0; i < teeth * 4; i += 1) {
    const a = ((i - 0.5) / (teeth * 4)) * Math.PI * 2;
    const r = i % 4 < 2 ? 9 : 7;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
})();
export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d={gearPath} />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 14.5v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5" />
    <path d="M12 15V4.5" />
    <path d="m7.5 8.8 4.5-4.5 4.5 4.5" />
  </Svg>
);

export const GlobeIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6.5 6.5 11 11" />
    <path d="m17.5 6.5-11 11" />
  </Svg>
);

export const RetryIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </Svg>
);

/** 小转圈：用于上传中、加载更多中 */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={`flex-none animate-spin ${className ?? ''}`}
    >
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2.2} />
      <path d="M20.5 12A8.5 8.5 0 0 0 12 3.5" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}
