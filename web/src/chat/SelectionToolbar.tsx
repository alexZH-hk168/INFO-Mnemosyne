// 规格：2-划词-划词工具条（chat.selection-toolbar）＋ 2-划词工具条-开分支追问（chat.toolbar-branch）
//       ＋ 2-划词工具条-引用（chat.toolbar-quote）＋ 2-划词工具条-复制（chat.toolbar-copy）
// 在主线助手回答正文里选中文字（mouseup，或键盘 Shift+方向键后松开）后，选区上方出现黑色工具条：开分支追问、引用、复制。
// - 只认一条主线助手回答的正文：选区跨消息、含步骤行、在分支面板或合并卡片里、回答还在生成中 → 不出现；选区 < 2 字不出现。
// - 选区换算成“去掉 [[E#]] 后纯文本”的码点偏移（lib/selection），胶囊文字不计入选区与复制内容；写入 useUI.selection。
// - 点别处 / Esc / 滚动 → 关闭（useUI.selection = null）。工具条打开时按 Tab 进入工具条，←/→ 在按钮间移动。
// - 开分支追问：POST /api/branches → 失效 ['tree', cid]、右栏新开分支标签并聚焦其输入框（路由由分支面板改为 /c/:cid/b/:bid）；
//   提交中按钮转圈；失败提示条，选区保留。标题由后端给（规格“默认取 quote 前 12 字”，见未决 U48）。
// - 引用：主线输入框插入 `> quote` 并聚焦，不建分支、不发请求。复制：写剪贴板，提示“已复制”。
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ConversationTree, ID } from '../api/types';
import { createBranch, openBranchTab } from '../branch/actions';
import { QuoteIcon } from '../icons/BranchIcons';
import { CopyIcon } from '../icons/ChatIcons';
import { BranchIcon, Spinner } from '../icons/Icons';
import { MIN_SELECTION, rangeToPlain } from '../lib/selection';
import { draftKey, emptyDraft, useChat } from '../store/chat';
import { useUI } from '../store/ui';
import { requestComposerFocus } from './focus';

const LIST = '[data-testid="chat.message-list"]';

/** 把一段文字写成 Markdown 引用块，末尾空一行让后续输入不并进引用 */
export function quoteBlock(quote: string): string {
  return `${quote
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')}\n\n`;
}

/** 当前窗口选区 → useUI.selection；不满足条件时返回 null */
export function readSelection(tree: ConversationTree): ReturnType<typeof useUI.getState>['selection'] {
  const s = window.getSelection();
  if (!s || s.isCollapsed || s.rangeCount === 0) return null;
  const range = s.getRangeAt(0);
  const list = document.querySelector(LIST);
  if (!list || !list.contains(range.commonAncestorContainer)) return null;
  const bodyOf = (n: Node) =>
    (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement)?.closest<HTMLElement>(
      '.mn-answer[data-message-id]',
    ) ?? null;
  const a = bodyOf(range.startContainer);
  const b = bodyOf(range.endContainer);
  if (!a || a !== b || a.dataset.streaming !== undefined) return null;
  const mid = a.dataset.messageId as ID;
  const msg = tree.messages.find((m) => m.id === mid);
  if (!msg || msg.role !== 'assistant' || msg.branch_id) return null;
  const r = rangeToPlain(a, msg.content, range);
  if (!r || r.end - r.start < MIN_SELECTION) return null;
  // jsdom 没有 Range.getBoundingClientRect
  const rect =
    typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : a.getBoundingClientRect();
  return {
    message_id: mid,
    start: r.start,
    end: r.end,
    quote: r.quote,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}

const clear = () => {
  if (useUI.getState().selection) useUI.setState({ selection: null });
};

export default function SelectionToolbar({ conversationId, tree }: { conversationId: ID; tree: ConversationTree }) {
  const qc = useQueryClient();
  const sel = useUI((s) => s.selection);
  const [pending, setPending] = useState(false);
  const bar = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const mine = !!sel && tree.messages.some((m) => m.id === sel.message_id);

  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    strategy: 'fixed',
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (!sel) return;
    const { x, y, width, height } = sel.rect;
    refs.setReference({
      getBoundingClientRect: () => ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }),
    });
  }, [sel, refs]);

  // 选区变化：mouseup / 键盘选择后读一次
  useEffect(() => {
    const update = (e: Event) => {
      if (bar.current?.contains(e.target as Node)) return;
      // 等浏览器把选区更新完
      setTimeout(() => {
        if (pendingRef.current) return;
        const next = readSelection(treeRef.current);
        if (next) useUI.setState({ selection: next });
        else clear();
      }, 0);
    };
    const onKeyUp = (e: globalThis.KeyboardEvent) => {
      if (e.shiftKey || e.key === 'Shift') update(e);
    };
    const onDown = (e: MouseEvent) => {
      if (!bar.current?.contains(e.target as Node) && !pendingRef.current) clear();
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!useUI.getState().selection) return;
      if (e.key === 'Escape') {
        // 同时取消浏览器选区：否则再在原处按下鼠标会变成拖动已选文字
        window.getSelection()?.removeAllRanges();
        clear();
      }
      // Tab 进入工具条（键盘可达）
      if (e.key === 'Tab' && !e.shiftKey && bar.current && !bar.current.contains(document.activeElement)) {
        const first = bar.current.querySelector<HTMLElement>('button');
        if (first) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const onScroll = (e: Event) => {
      const t = e.target as Element | Document;
      if (t instanceof Element && t.closest?.('[data-testid="chat.selection-toolbar"]')) return;
      if (!pendingRef.current) clear();
    };
    document.addEventListener('mouseup', update);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown, true); // 捕获阶段：先于输入框自己的按键处理
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mouseup', update);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  // 换对话时收起
  useEffect(() => clear, [conversationId]);

  if (!sel || !mine) return null;

  const done = () => {
    window.getSelection()?.removeAllRanges();
    clear();
  };

  const onBranch = async () => {
    if (pending) return;
    setPending(true);
    try {
      const b = await createBranch(qc, {
        conversation_id: conversationId,
        fork_message_id: sel.message_id,
        anchor: { start: sel.start, end: sel.end, quote: sel.quote },
      });
      done();
      openBranchTab(b);
      requestComposerFocus('branch');
    } catch (err) {
      // 失败：提示条，选区保留
      useUI.getState().pushToast({ kind: 'error', text: `开分支失败：${(err as Error).message}` });
    } finally {
      setPending(false);
    }
  };

  const onQuote = () => {
    const key = draftKey(conversationId);
    const chat = useChat.getState();
    const cur = (chat.composer[key] ?? emptyDraft()).text;
    const block = quoteBlock(sel.quote);
    chat.setDraft(key, { text: cur.trim() ? `${cur.replace(/\s+$/, '')}\n\n${block}` : block });
    done();
    requestComposerFocus('chat');
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(sel.quote);
      useUI.getState().pushToast({ kind: 'success', text: '已复制' });
      done();
    } catch (err) {
      useUI.getState().pushToast({ kind: 'error', text: `复制失败：${(err as Error).message}` });
    }
  };

  const onBarKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(bar.current?.querySelectorAll<HTMLElement>('button') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  };

  const btn =
    'mn-focus inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[12.5px] font-medium text-surface hover:bg-white/15 disabled:opacity-70';

  return (
    <div
      ref={(el) => {
        bar.current = el;
        refs.setFloating(el);
      }}
      style={floatingStyles}
      role="toolbar"
      aria-label="选中文字操作"
      data-testid="chat.selection-toolbar"
      data-message-id={sel.message_id}
      data-start={sel.start}
      data-end={sel.end}
      onKeyDown={onBarKey}
      onMouseDown={(e) => e.preventDefault()}
      className="z-40 flex items-center gap-0.5 rounded-btn bg-ink p-1 shadow-[var(--shadow-pop)]"
    >
      <button
        type="button"
        data-testid="chat.toolbar-branch"
        data-state={pending ? 'pending' : 'idle'}
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={() => void onBranch()}
        className={btn}
      >
        {pending ? <Spinner size={13} /> : <BranchIcon size={13} />}
        开分支追问
      </button>
      <button type="button" data-testid="chat.toolbar-quote" onClick={onQuote} className={btn}>
        <QuoteIcon size={13} />
        引用
      </button>
      <button type="button" data-testid="chat.toolbar-copy" onClick={() => void onCopy()} className={btn}>
        <CopyIcon size={13} />
        复制
      </button>
    </div>
  );
}
