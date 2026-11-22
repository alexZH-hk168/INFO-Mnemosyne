// 规格：2-市场页-条目卡片（market.card）
// 首字母色块、名称、作者、官方/社区、一句话用途、星数、许可证、类别、安装状态按钮。
// 卡片主体是一个覆盖整张卡的按钮（进入详情）；安装按钮与它是兄弟节点，点击不冒泡。
import type { MarketItem } from '../api/types';
import { formatStarsShort, starsTooltip } from './format';
import { StarIcon } from './icons';
import InstallButton from './InstallButton';
import Logo, { CategoryTag, OfficialTag } from './Logo';
import { openDetail } from './marketNav';

export default function MarketCard({ item, index }: { item: MarketItem; index: number }) {
  return (
    <div
      data-testid={`market.card:${item.id}`}
      data-type={item.type}
      className="group relative flex min-h-[148px] flex-col gap-2 rounded-panel border border-line bg-surface px-4 pb-3 pt-3.5 transition-shadow hover:shadow-[0_0_0_2px_var(--card-hl)] has-[button[data-card-open]:focus-visible]:shadow-[0_0_0_2px_var(--handle)]"
    >
      <button
        type="button"
        data-card-open=""
        data-testid={`market.card.open:${item.id}`}
        aria-label={`${item.name} 详情`}
        onClick={() => openDetail(item.type, item.id)}
        className="absolute inset-0 rounded-panel outline-none"
      />
      <div className="pointer-events-none flex items-center gap-2.5">
        <Logo name={item.name} index={index} />
        <div className="min-w-0">
          <div data-testid="market.card.name" className="truncate text-[14px] font-semibold text-ink">
            {item.name}
          </div>
          <div className="flex items-center gap-[5px] text-[11.5px] text-muted">
            <span data-testid="market.card.owner">{item.owner}</span>
            <OfficialTag official={item.official} />
          </div>
        </div>
      </div>
      <p data-testid="market.card.desc" className="pointer-events-none flex-1 text-[12.8px] leading-[1.6] text-ink-2">
        {item.desc_zh}
      </p>
      <div className="pointer-events-none flex items-center gap-3 text-[11.5px] text-muted">
        {item.stars_date && (
          <span
            data-testid="market.card.stars"
            title={starsTooltip(item)}
            className="pointer-events-auto relative inline-flex items-center gap-1"
          >
            <StarIcon />
            {formatStarsShort(item.stars)}
          </span>
        )}
        {item.license && <span data-testid="market.card.license">{item.license}</span>}
        <CategoryTag category={item.category} />
        <span className="pointer-events-auto relative ml-auto flex">
          <InstallButton item={item} />
        </span>
      </div>
    </div>
  );
}

/** 加载中的卡片骨架 */
export function MarketCardSkeleton() {
  return (
    <div
      data-testid="market.card-skeleton"
      className="flex min-h-[148px] flex-col gap-3 rounded-panel border border-line bg-surface px-4 py-3.5"
    >
      <div className="flex items-center gap-2.5">
        <div className="mn-skel h-9 w-9" />
        <div className="flex-1 space-y-1.5">
          <div className="mn-skel h-3 w-1/2" />
          <div className="mn-skel h-2.5 w-1/3" />
        </div>
      </div>
      <div className="mn-skel h-3 w-4/5" />
      <div className="mt-auto mn-skel h-2.5 w-2/5" />
    </div>
  );
}
