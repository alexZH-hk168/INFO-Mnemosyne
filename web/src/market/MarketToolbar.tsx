// 规格：2-市场页-搜索框（market.search）
// 按名称、作者、描述、类别模糊匹配（前端过滤）；150 ms 防抖后写入 URL `?q=`；有输入时右侧 × 清空。
import { useEffect, useRef, useState } from 'react';
import { CloseIcon } from '../icons/Icons';
import { SearchIcon } from './icons';

export const SEARCH_DEBOUNCE_MS = 150;

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (q: string) => void;
  placeholder: string;
}) {
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // 外部（如“清空筛选”、浏览器后退）改了 q 时同步
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = window.setTimeout(() => onChange(text), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <div className="flex h-[34px] w-[360px] flex-none items-center gap-2 rounded-card-sm border border-line bg-canvas px-3 text-faint focus-within:border-handle">
      <SearchIcon />
      <input
        ref={inputRef}
        data-testid="market.search"
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && text) {
            e.preventDefault();
            setText('');
            onChange('');
          }
        }}
        placeholder={placeholder}
        aria-label="搜索市场条目"
        className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button
          type="button"
          data-testid="market.search.clear"
          aria-label="清空搜索"
          onClick={() => {
            setText('');
            onChange('');
            inputRef.current?.focus();
          }}
          className="mn-focus -mr-1 rounded-btn-sm p-0.5 text-muted hover:bg-sel hover:text-ink"
        >
          <CloseIcon size={13} />
        </button>
      )}
    </div>
  );
}
