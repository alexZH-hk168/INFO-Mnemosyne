// 规格：2-市场页-类别筛选（market.category）
// 类别胶囊单选（“全部”＋当前标签数据中出现的类别）；再点取消；本地 state 写入 URL `?cat=`。
export default function CategoryChips({
  categories,
  value,
  onChange,
}: {
  categories: string[];
  value: string | null;
  onChange: (cat: string | null) => void;
}) {
  const chip = (key: string, label: string, on: boolean, next: string | null) => (
    <button
      key={key}
      type="button"
      data-testid={`market.category:${key}`}
      aria-pressed={on}
      onClick={() => onChange(next)}
      className={`mn-focus flex-none whitespace-nowrap rounded-pill border px-[11px] py-1 text-[12.5px] ${
        on ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-ink-2 hover:bg-sel'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div
      data-testid="market.category"
      role="group"
      aria-label="按类别筛选"
      className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]"
    >
      {chip('all', '全部', value === null, null)}
      {categories.map((c) => chip(c, c, value === c, value === c ? null : c))}
    </div>
  );
}
