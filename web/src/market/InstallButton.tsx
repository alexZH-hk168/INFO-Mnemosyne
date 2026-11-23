// 规格：2-条目卡片-安装按钮（market.install-button）
// 卡片与详情页右上共用。插件 → 打开安装确认弹窗（useUI.openModal('install', {pluginId})）；Skill → 直接导入并启用；
// 已安装 → 进入详情（在详情页里不再跳转）。
// F6b 追加（编排决定，来自 B3b U92）：插件详情没有 manifest（没有 Mnemosyne 适配清单）时按钮置灰，旁边写“暂未适配，第一版不能安装”。
import { useIsMutating } from '@tanstack/react-query';
import type { MouseEvent } from 'react';
import { ApiRequestError } from '../api/client';
import type { MarketItem } from '../api/types';
import { Spinner } from '../icons/Icons';
import { useUI } from '../store/ui';
import { installKey, NOT_ADAPTED_HINT, useImportSkill, useInstallState, usePluginAdapted } from './hooks';
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
  // v0.3：由市场条目的 verified 字段决定；字段缺省（旧后端）时不标
  const adapted = usePluginAdapted(item, installed);
  const unverified = adapted && item.type === 'plugin' && item.verified === false;
  const blocked = !installed && !adapted;

  const onClick = (e: MouseEvent) => {
    e.stopPropagation(); // 与卡片主体是兄弟节点，仍保险起见不冒泡
    if (busy || blocked) return;
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

  const state = installed ? 'installed' : blocked ? 'unavailable' : busy ? 'busy' : 'idle';

  if (variant === 'detail') {
    return (
      <>
        <button
          type="button"
          data-testid={testid}
          data-state={state}
          aria-busy={busy || undefined}
          disabled={blocked}
          aria-describedby={blocked ? 'market-install-not-adapted' : undefined}
          onClick={onClick}
          className="mn-focus flex h-10 w-full items-center justify-center gap-1.5 rounded-card-sm bg-ink text-[14px] text-surface disabled:cursor-not-allowed disabled:bg-[var(--perm-note)] disabled:text-muted"
        >
          {busy ? <Spinner size={14} /> : installed ? <CheckIcon size={14} /> : null}
          {label}
        </button>
        {blocked && (
          <p
            id="market-install-not-adapted"
            data-testid="market.install-button.not-adapted"
            className="mt-1.5 text-center text-[12px] text-muted"
          >
            {NOT_ADAPTED_HINT}
          </p>
        )}
      </>
    );
  }

  return (
    <span className="relative ml-auto flex flex-none items-center gap-1.5">
      {blocked && (
        // 卡片底行放不下整句（会挤掉类别标签），提示放在按钮正上方、右对齐
        <span
          data-testid={`market.install-button.not-adapted:${item.id}`}
          className="pointer-events-none absolute bottom-full right-0 mb-1 whitespace-nowrap text-[11px] text-muted"
        >
          {NOT_ADAPTED_HINT}
        </span>
      )}
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
        data-state={state}
        aria-busy={busy || undefined}
        disabled={blocked}
        aria-label={
          installed
            ? `${item.name}：${label}，查看详情`
            : blocked
              ? `${item.name}：${NOT_ADAPTED_HINT}`
              : `${label} ${item.name}`
        }
        onClick={onClick}
        className={`mn-focus inline-flex items-center gap-1 rounded-btn border px-3 py-1 text-[12px] ${
          installed
            ? 'border-[var(--done-line)] bg-[var(--done-bg)] text-ok'
            : blocked
              ? 'cursor-not-allowed border-line bg-panel text-faint'
              : 'border-line bg-surface text-ink hover:bg-sel'
        }`}
      >
        {busy && <Spinner size={11} />}
        {label}
      </button>
    </span>
  );
}
