// 插件详情与 Skill 详情共用的小块：面包屑、加载与失败态、右侧卡片外框。
import type { ReactNode } from 'react';
import { Spinner } from '../icons/Icons';
import type { MarketRoute } from '../store/layout';
import { ChevronRight } from './icons';
import { backToList } from './marketNav';

const TAB_LABEL: Record<MarketRoute['tab'], string> = {
  plugins: '插件市场',
  skills: 'Skill 市场',
  installed: '已安装',
};

/** 面包屑：插件与 Skill › 插件市场 › 名称（点前两级回列表：marketRoute.detail=undefined） */
export function Breadcrumbs({ tab, name }: { tab: MarketRoute['tab']; name: string }) {
  return (
    <nav
      aria-label="面包屑"
      data-testid="market.breadcrumbs"
      className="flex items-center gap-1.5 px-9 pt-5 text-[12.5px] text-muted"
    >
      <button
        type="button"
        data-testid="market.breadcrumbs.root"
        onClick={() => backToList(tab === 'installed' ? 'installed' : tab)}
        className="mn-focus rounded-btn-sm hover:text-ink"
      >
        插件与 Skill
      </button>
      <ChevronRight />
      <button
        type="button"
        data-testid="market.breadcrumbs.tab"
        onClick={() => backToList(tab)}
        className="mn-focus rounded-btn-sm hover:text-ink"
      >
        {TAB_LABEL[tab]}
      </button>
      <ChevronRight />
      <b aria-current="page" className="font-medium text-ink">
        {name}
      </b>
    </nav>
  );
}

export function DetailLoading() {
  return (
    <div data-testid="market.detail.loading" className="flex items-center gap-2 px-9 pt-8 text-[13px] text-muted">
      <Spinner size={13} /> 正在读取详情…
    </div>
  );
}

export function DetailError({
  message,
  onRetry,
  onBack,
}: {
  message: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div
      data-testid="market.detail.error"
      role="alert"
      className="flex items-center gap-2 px-9 pt-8 text-[13px] text-ink-2"
    >
      详情加载失败：{message} ·
      <button type="button" onClick={onRetry} className="mn-focus rounded-btn-sm underline underline-offset-2">
        重试
      </button>
      ·
      <button type="button" onClick={onBack} className="mn-focus rounded-btn-sm underline underline-offset-2">
        回列表
      </button>
    </div>
  );
}

export function SidePanel({
  testid,
  icon,
  title,
  children,
}: {
  testid: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testid} className="rounded-panel border border-line bg-surface px-4 py-3.5">
      <h4 className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        {icon}
        {title}
      </h4>
      {children}
    </section>
  );
}
