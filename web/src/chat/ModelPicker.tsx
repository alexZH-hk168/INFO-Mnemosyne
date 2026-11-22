// 规格：1-输入框-模型档位（composer.model）
// 文本框下方“✦ 模型 · 高”。v1 两档：高（设置里的对话模型）与快（设置里的小模型）；选择是本地 state，随发送写入请求头 X-Model-Tier。
// 设置里没有对话模型时显示“未配置模型”，点击打开设置。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSettings } from '../api/queries';
import { SparkleIcon } from '../icons/ChatIcons';
import type { ModelTier } from '../store/chat';
import { useUI } from '../store/ui';

/** 档位在输入框之间延续（主页 → 对话栏会换一个输入框实例）；只是本地记忆，不进 store */
let lastTier: ModelTier = 'high';
export const getLastTier = () => lastTier;

const TIER_LABEL: Record<ModelTier, string> = { high: '高', fast: '快' };

interface Props {
  tier: ModelTier;
  onChange: (t: ModelTier) => void;
}

export default function ModelPicker({ tier, onChange }: Props) {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const unconfigured = settings.isSuccess && !settings.data.chat_model.trim();

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (t: ModelTier) => {
    lastTier = t;
    onChange(t);
    setOpen(false);
    btn.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };

  if (unconfigured) {
    return (
      <button
        type="button"
        data-testid="composer.model"
        data-state="unconfigured"
        onClick={() => useUI.getState().openModal('settings')}
        className="mn-focus inline-flex h-7 items-center gap-1.5 rounded-pill px-1.5 text-[13px] text-danger"
      >
        <SparkleIcon size={14} />
        未配置模型
      </button>
    );
  }

  const models: Record<ModelTier, string> = {
    high: settings.data?.chat_model ?? '',
    fast: settings.data?.small_model ?? '',
  };
  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        data-testid="composer.model"
        data-tier={tier}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="mn-focus inline-flex h-7 items-center gap-1.5 rounded-pill px-1.5 text-[13px] text-ink-2 hover:text-ink"
      >
        <SparkleIcon size={14} />
        模型 · {TIER_LABEL[tier]}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="模型档位"
          data-testid="composer.model.menu"
          onKeyDown={onKey}
          className="absolute bottom-full left-0 z-30 mb-2 w-[220px] rounded-card border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
        >
          {(['high', 'fast'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={tier === t}
              data-testid={`composer.model.option:${t}`}
              onClick={() => choose(t)}
              className="mn-focus flex w-full flex-col rounded-btn px-2.5 py-1.5 text-left hover:bg-sel focus-visible:bg-sel"
            >
              <span className="text-[13px] text-ink">
                {TIER_LABEL[t]}
                {tier === t && <span className="ml-1.5 text-[11px] text-muted">当前</span>}
              </span>
              <span className="truncate text-[11.5px] text-muted">
                {t === 'high' ? '对话模型' : '小模型'}
                {models[t] ? ` · ${models[t]}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
