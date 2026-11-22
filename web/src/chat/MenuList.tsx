// @ 引用列表与 / Skill 列表共用的弹层外观（规格 2-艾特-文件引用列表「样式与 / 列表一致」）。
// 键盘由输入框驱动（焦点留在文本框，↑↓ 移动、Enter 选择、Esc 关闭），列表用 aria-activedescendant 标出当前项。
import type { ReactNode } from 'react';

export interface MenuItem {
  id: string;
  /** data-testid 后缀 */
  testId: string;
  icon: ReactNode;
  title: string;
  sub?: string;
}

interface Props {
  testid: string;
  label: string;
  heading: string;
  items: MenuItem[];
  active: number;
  empty: ReactNode;
  onPick: (item: MenuItem) => void;
  onHover: (i: number) => void;
}

export const menuOptionId = (testid: string, id: string) => `${testid}-opt-${id}`;

export default function MenuList({ testid, label, heading, items, active, empty, onPick, onHover }: Props) {
  return (
    <div
      data-testid={testid}
      className="absolute bottom-full left-0 z-30 mb-2 w-[min(390px,100%)] overflow-hidden rounded-card border border-line bg-surface py-1.5 shadow-[var(--shadow-pop)]"
    >
      <div className="px-3.5 pb-1 pt-1 text-[11.5px] text-muted">{heading}</div>
      {items.length === 0 ? (
        <div className="px-3.5 py-2 text-[12.5px] text-muted">{empty}</div>
      ) : (
        <ul
          role="listbox"
          aria-label={label}
          id={`${testid}-list`}
          className="max-h-[260px] overflow-y-auto"
          onMouseDown={(e) => e.preventDefault() /* 保持文本框焦点 */}
        >
          {items.map((it, i) => (
            <li
              key={it.id}
              id={menuOptionId(testid, it.id)}
              role="option"
              aria-selected={i === active}
              data-testid={`${testid}.item:${it.testId}`}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(it)}
              className={`mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-btn px-2 py-1.5 ${
                i === active ? 'bg-sel' : ''
              }`}
            >
              {it.icon}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{it.title}</span>
                {it.sub && <span className="block truncate text-[11.5px] text-muted">{it.sub}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
