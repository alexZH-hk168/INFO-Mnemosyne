// 规格：1-项目栏-用户卡片（sidebar.user-card）
// 单用户本机版：显示名字段不在 Settings 契约内（未决 U9），v1 固定显示“我”，身份小字“本机”。点整行或齿轮打开设置。
import { useSettings } from '../api/queries';
import { GearIcon } from '../icons/Icons';
import { useUI } from '../store/ui';

export const USER_NAME = '我';
export const USER_SUB = '本机';

export default function UserCard() {
  useSettings(); // 规格：挂载时读 ['settings']；显示名字段待 U9
  const openModal = useUI((s) => s.openModal);
  return (
    <button
      type="button"
      data-testid="sidebar.user-card"
      aria-label="打开设置"
      onClick={() => openModal('settings')}
      className="mn-focus group mt-auto flex w-full flex-none items-center gap-[9px] border-t border-line px-1.5 pb-0.5 pt-2.5 text-left"
    >
      <span
        aria-hidden="true"
        className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-pill bg-avatar text-[12px] text-ink-2"
      >
        {USER_NAME.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-[1.45] text-ink">{USER_NAME}</span>
        <span className="block text-[11.5px] leading-[1.45] text-muted">{USER_SUB}</span>
      </span>
      <span className="mn-iconbtn group-hover:bg-sel group-hover:text-ink" aria-hidden="true">
        <GearIcon />
      </span>
    </button>
  );
}
