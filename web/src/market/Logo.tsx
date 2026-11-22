// 首字母色块（概念图 UI-07～10）：两个字母，颜色按条目在 registry 中的序号轮换。
import { initials, logoColor } from './format';

const SIZE = {
  sm: 'h-[26px] w-[26px] rounded-btn-sm text-[10.5px]',
  md: 'h-9 w-9 rounded-card-sm text-[13px]',
  lg: 'h-14 w-14 rounded-panel text-[18px]',
} as const;

export default function Logo({ name, index, size = 'md' }: { name: string; index: number; size?: keyof typeof SIZE }) {
  return (
    <span
      aria-hidden="true"
      className={`flex flex-none items-center justify-center font-bold text-surface ${SIZE[size]}`}
      style={{ background: index >= 0 ? logoColor(index) : 'var(--logo-7)' }}
    >
      {initials(name)}
    </span>
  );
}

/** “官方 / 社区”小标签 */
export function OfficialTag({ official }: { official: boolean }) {
  return (
    <span
      data-official={official ? 'true' : 'false'}
      className={`rounded-chip px-[5px] text-[10.5px] leading-[16px] ${
        official
          ? 'bg-[var(--tag-official-bg)] text-[var(--tag-official-ink)]'
          : 'bg-[var(--tag-community-bg)] text-[var(--tag-community-ink)]'
      }`}
    >
      {official ? '官方' : '社区'}
    </span>
  );
}

export function CategoryTag({ category }: { category: string }) {
  return <span className="rounded-chip bg-panel px-1.5 py-px text-[11px] text-muted">{category}</span>;
}
