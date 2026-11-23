// 规格：2-插件区-会话插件弹层（plugins.popover）＋ 2-会话插件弹层-插件开关（plugins.toggle）＋ 2-会话插件弹层-去插件市场（plugins.go-market）
// 输入框上方弹层（概念图 UI-11）。上半“本对话的插件”：已安装插件的开关；下半“Skill · 输入 / 直接调用”：已启用 Skill；底部“去插件市场 ›”。
// 打开：useUI.popover === 'plugins'（由 1-输入框-插件区入口 切换）。关闭：点外部、Esc、去市场、选 Skill。
// 状态：无已安装插件 → “还没有安装插件”；status=error 或缺配置 → 开关置灰关闭，副标题写原因。
// 副标题：类别 · 本轮调用 N 次（由当前回答的 step 统计，见 pluginRows.ts）。
import { useEffect, useRef, useState } from 'react';
import { useMarket, useSkills } from '../../api/queries';
import type { ID } from '../../api/types';
import { GearIcon, PuzzleIcon } from '../../icons/Icons';
import { goMarket } from '../../lib/nav';
import Logo from '../../market/Logo';
import { ChevronRight } from '../../market/icons';
import Switch from '../../settings/Switch';
import { draftKey, NEW_MAIN, useChat } from '../../store/chat';
import { useUI } from '../../store/ui';
import { requestComposerFocus } from '../focus';
import { usePluginRows } from './pluginRows';
import { usePluginToggle } from './usePluginToggle';

export const POPOVER_TESTID = 'plugins.popover';
/** 插件区入口带这个属性：点它不算“点外部”（入口自己负责开关） */
export const ENTRY_ATTR = 'data-plugin-entry';

const close = () => useUI.setState({ popover: null });

export default function PluginPopover({ cid }: { cid: ID | null | undefined }) {
  const { rows, ready } = usePluginRows(cid);
  const toggle = usePluginToggle(cid, rows);
  const skills = useSkills();
  const skillMarket = useMarket('skills');
  const ref = useRef<HTMLDivElement>(null);
  // 触发元素在渲染时取（开发模式 StrictMode 会把 effect 跑两遍，第二遍时焦点已经进了弹层，取不到胶囊）
  const [opener] = useState<HTMLElement | null>(() => {
    const a = typeof document === 'undefined' ? null : document.activeElement;
    return a instanceof HTMLElement && a.closest(`[${ENTRY_ATTR}]`) ? a : null;
  });
  const focused = useRef(false);

  const enabledSkills = (skills.data?.skills ?? []).filter((s) => s.enabled);
  const skillIndex = (id: ID) => skillMarket.data?.items.findIndex((i) => i.id === id) ?? -1;

  // 打开后（插件列表就绪时）把焦点放到第一个可用开关；没有开关就放到第一个按钮
  useEffect(() => {
    if (focused.current || !ready) return;
    focused.current = true;
    const first =
      ref.current?.querySelector<HTMLElement>('[role="switch"]:not([disabled])') ??
      ref.current?.querySelector<HTMLElement>('button:not([disabled])');
    first?.focus({ preventScroll: true });
  }, [ready]);

  // 关闭（卸载）后焦点回到触发元素：只在焦点随弹层一起丢到 body 时归还，不抢走去市场、选 Skill 后别处的焦点
  useEffect(
    () => () => {
      const now = document.activeElement;
      if (opener && opener.isConnected && (!now || now === document.body)) opener.focus({ preventScroll: true });
    },
    [opener],
  );

  // 点外部、Esc 关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || t.closest(`[${ENTRY_ATTR}]`)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
      opener?.focus({ preventScroll: true });
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [opener]);

  const pickSkill = (name: string) => {
    // 规格「点 Skill 行」：在输入框插入 /name（与 / 列表同一效果：文本框前的不可拆小标签，composer.forced_skill）
    const key = cid ? draftKey(cid, null) : NEW_MAIN;
    useChat.getState().setDraft(key, { forced_skill: name });
    close();
    requestComposerFocus(cid ? 'chat' : 'home');
  };

  const toMarket = (tab: 'plugins' | 'installed') => {
    close();
    goMarket({ tab });
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="本对话的插件"
      data-testid={POPOVER_TESTID}
      className="absolute bottom-full left-0 z-30 mb-2 w-[min(390px,100%)] overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-pop)]"
    >
      <div className="flex items-center justify-between px-3.5 pb-1 pt-2.5">
        <span className="text-[11.5px] text-muted">本对话的插件</span>
        <button
          type="button"
          data-testid="plugins.popover.settings"
          aria-label="管理已安装插件"
          title="管理已安装插件"
          onClick={() => toMarket('installed')}
          className="mn-focus grid h-6 w-6 place-items-center rounded-btn-sm text-muted hover:bg-sel hover:text-ink"
        >
          <GearIcon size={14} />
        </button>
      </div>

      {!ready ? (
        <div className="px-3.5 py-3 text-[12.5px] text-muted">读取插件…</div>
      ) : rows.length === 0 ? (
        <div data-testid="plugins.popover.empty" className="px-3.5 py-3 text-[12.5px] text-muted">
          还没有安装插件
        </div>
      ) : (
        <ul className="pb-1.5" aria-label="插件">
          {rows.map((r) => (
            <li
              key={r.id}
              data-testid={`plugins.popover.row:${r.id}`}
              data-usable={r.usable ? 'true' : 'false'}
              className="mx-1.5 flex items-center gap-2.5 rounded-btn px-2 py-[7px]"
            >
              <Logo name={r.name} index={r.index} size="sm" />
              <span className={`min-w-0 flex-1 ${r.usable ? '' : 'opacity-75'}`}>
                <span className="block truncate text-[13.5px] text-ink">{r.name}</span>
                <span data-testid={`plugins.popover.sub:${r.id}`} className="block truncate text-[11.5px] text-muted">
                  {r.sub}
                </span>
              </span>
              <Switch
                testid={`plugins.toggle:${r.id}`}
                label={r.usable ? `在本对话启用 ${r.name}` : `${r.name} 不可用：${r.reason ?? ''}`}
                checked={r.enabled}
                disabled={!r.usable}
                onChange={(v) => void toggle(r.id, v)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-line px-3.5 pb-1 pt-2.5 text-[11.5px] text-muted">Skill · 输入 / 直接调用</div>
      {enabledSkills.length === 0 ? (
        <div data-testid="plugins.popover.skills-empty" className="px-3.5 pb-2.5 pt-1 text-[12.5px] text-muted">
          没有已启用的 Skill
        </div>
      ) : (
        <ul className="pb-1.5" aria-label="Skill">
          {enabledSkills.map((s) => (
            <li key={s.id} className="mx-1.5">
              <button
                type="button"
                data-testid={`plugins.popover.skill:${s.id}`}
                onClick={() => pickSkill(s.name)}
                title={`本轮强制使用 /${s.name}`}
                className="mn-focus flex w-full items-center gap-2.5 rounded-btn px-2 py-[7px] text-left hover:bg-sel"
              >
                <Logo name={s.name} index={skillIndex(s.id)} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-ink">/{s.name}</span>
                  <span className="block truncate text-[11.5px] text-muted">{s.description}</span>
                </span>
                <span
                  className="flex-none rounded-chip bg-panel px-1.5 text-[11px] leading-[18px] text-muted"
                  title="模型按需自动加载；点这一行则本轮强制使用"
                >
                  自动
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-line p-1.5">
        <button
          type="button"
          data-testid="plugins.go-market"
          onClick={() => toMarket('plugins')}
          className="mn-focus flex w-full items-center gap-1.5 rounded-btn px-2 py-1.5 text-[13px] text-ink-2 hover:bg-sel hover:text-ink"
        >
          <PuzzleIcon size={14} />
          去插件市场
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
