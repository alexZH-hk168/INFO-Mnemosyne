// 规格：2-条目卡片-安装按钮（market.install-button）
// 卡片与详情页右上共用。插件 → 打开安装确认弹窗（useUI.openModal('install', {pluginId})）；Skill → 直接导入并启用；
// 已安装 → 进入详情（在详情页里不再跳转）。
import { useIsMutating } from '@tanstack/react-query';
import type { MouseEvent } from 'react';
import { ApiRequestError } from '../api/client';
import type { MarketItem } from '../api/types';
import { Spinner } from '../icons/Icons';
import { useUI } from '../store/ui';
import { V1_VERIFIED_PLUGINS } from './format';
import { installKey, useImportSkill, useInstallState } from './hooks';
import { CheckIcon } from './icons';
import { openDetail } from './marketNav';

export interface InstallButtonProps {
  item: MarketItem;
  variant?: 'card' | 'detail';
}

export default function InstallButton({ item, variant = 'card' }: InstallButtonProps) {
  const openModal = useUI((s) => s.openModal);
  const pushToast = useUI((s) => s.pushToast);
  const { installed, enabledHere } = useInstallState(item);
  const importSkill = useImportSkill();
  const pluginInstalling = useIsMutating({ mutationKey: installKey(item.id) }) > 0;
  const busy = item.type === 'plugin' ? pluginInstalling : importSkill.isPending;
  const testid = variant === 'card' ? `market.install-button:${item.id}` : 'market.install-button';
  const unverified = item.type === 'plugin' && !V1_VERIFIED_PLUGINS.includes(item.id);

  const onClick = (e: MouseEvent) => {
    e.stopPropagation(); // 与卡片主体是兄弟节点，仍保险起见不冒泡
    if (busy) return;
    if (installed) {
      if (variant === 'card') openDetail(item.type, item.id);
      return;
    }
    if (item.type === 'plugin') {
      openModal('install', { pluginId: item.id });
      return;
    }
    importSkill.mutate(
      { source: 'github', url: item.repo_url },
      {
        onSuccess: () => pushToast({ kind: 'success', text: `已导入并启用 Skill「${item.name}」` }),
        onError: (err) => {
          const reason =
            err instanceof ApiRequestError && err.code === 'SKILL_INVALID'
              ? `SKILL.md 不合规：${err.message}`
              : err.message;
          pushToast({ kind: 'error', text: `导入「${item.name}」失败：${reason}` });
        },
      },
    );
  };

  const label = busy
    ? item.type === 'plugin'
      ? '安装中'
      : '导入中'
    : installed
      ? enabledHere
        ? '已安装 · 本对话已启用'
        : variant === 'card'
          ? '已安装 ✓'
          : '已安装'
      : '安装';

  if (variant === 'detail') {
    return (
      <button
        type="button"
        data-testid={testid}
        data-state={installed ? 'installed' : busy ? 'busy' : 'idle'}
        aria-busy={busy || undefined}
        onClick={onClick}
        className="mn-focus flex h-10 w-full items-center justify-center gap-1.5 rounded-card-sm bg-ink text-[14px] text-surface"
      >
        {busy ? <Spinner size={14} /> : installed ? <CheckIcon size={14} /> : null}
        {label}
      </button>
    );
  }

  return (
    <span className="ml-auto flex flex-none items-center gap-1.5">
      {unverified && (
        <span
          data-testid={`market.install-button.unverified:${item.id}`}
          className="text-[11px] text-faint"
          title="第一版只完整验收了 ArXiv 与 Fetch 两个插件"
        >
          未验收
        </span>
      )}
      <button
        type="button"
        data-testid={testid}
        data-state={installed ? 'installed' : busy ? 'busy' : 'idle'}
        aria-busy={busy || undefined}
        aria-label={installed ? `${item.name}：${label}，查看详情` : `${label} ${item.name}`}
        onClick={onClick}
        className={`mn-focus inline-flex items-center gap-1 rounded-btn border px-3 py-1 text-[12px] ${
          installed
            ? 'border-[var(--done-line)] bg-[var(--done-bg)] text-ok'
            : 'border-line bg-surface text-ink hover:bg-sel'
        }`}
      >
        {busy && <Spinner size={11} />}
        {label}
      </button>
    </span>
  );
}
