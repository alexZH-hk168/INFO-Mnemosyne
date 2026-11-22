// 规格：2-斜杠-Skill选择列表（composer.slash；里程碑 F6，F3 先做外观与插入逻辑）
// 行首键入 “/” 弹出已启用 Skill（['skills'] 里 enabled 的），按名称前缀过滤；选中后文本框前出现不可拆的 `/pdf` 小标签，
// 写入 composer.forced_skill。每轮最多一个，再选会替换。TODO(F6)：与会话插件弹层下半部共用数据与“自动”标记。
import type { Skill } from '../api/types';
import { goMarket } from '../lib/nav';
import MenuList, { type MenuItem } from './MenuList';

export const SLASH_TESTID = 'composer.slash';

export function slashItems(skills: Skill[], query: string): MenuItem[] {
  const q = query.toLowerCase();
  return skills
    .filter((s) => s.enabled && s.name.toLowerCase().startsWith(q))
    .map((s) => ({
      id: s.id,
      testId: s.id,
      icon: (
        <span
          aria-hidden="true"
          className="grid h-7 w-7 flex-none place-items-center rounded-btn-sm bg-panel-2 text-[11px] font-semibold text-ink-2"
        >
          {s.name.slice(0, 2).replace(/^./, (c) => c.toUpperCase())}
        </span>
      ),
      title: `/${s.name}`,
      sub: s.description,
    }));
}

interface Props {
  items: MenuItem[];
  active: number;
  onPick: (item: MenuItem) => void;
  onHover: (i: number) => void;
}

export default function SlashMenu({ items, active, onPick, onHover }: Props) {
  return (
    <MenuList
      testid={SLASH_TESTID}
      label="Skill"
      heading="Skill · 本轮强制使用"
      items={items}
      active={active}
      empty={
        <span>
          没有匹配的 Skill ·{' '}
          <button
            type="button"
            data-testid="composer.slash.market"
            className="mn-focus rounded-btn-sm text-ink-2 underline-offset-2 hover:underline"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => goMarket({ tab: 'skills' })}
          >
            去 Skill 市场
          </button>
        </span>
      }
      onPick={onPick}
      onHover={onHover}
    />
  );
}
