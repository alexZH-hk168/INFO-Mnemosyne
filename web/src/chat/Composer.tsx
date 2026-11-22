// 规格：1-外壳-输入框（composer.box）＋ 1-输入框-发送停止按钮（composer.send）＋ 1-输入框-附件按钮（composer.attach）
// 主页、对话栏、分支面板共用的输入框。外层托条：联网检索、引用范围、已启用插件；内层：文本框、+ 附件、模型档位、发送/停止。
// 草稿按 `branchId ?? 'main'` 存在 useChat.composer；Enter 发送、Shift+Enter 换行、输入法组字中不发送；文本框最多 8 行后滚动。
// @ 引用以 `@文件名` 写进文本（背后一层高亮成小标签，退格整块删除），文件 id 记在 scope.document_ids；
// / Skill 选中后变成文本框前不可拆的小标签（forced_skill）。语音按钮 v1 不做。
import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import { queryKeys, useDocuments, useSettings, useSkills } from '../api/queries';
import type { Conversation, Document, ID, Scope } from '../api/types';
import { DOC_DRAG_TYPE, TypeBadge } from '../files/FileRow';
import { CloseIcon, PlusIcon, Spinner } from '../icons/Icons';
import { ArrowUpIcon, StopIcon } from '../icons/ChatIcons';
import { goConversation } from '../lib/nav';
import { ACCEPT_ATTR, rejectedText, splitAccepted, uploadFiles } from '../lib/upload';
import { emptyDraft, MAIN, useChat, type ComposerDraft, type ModelTier } from '../store/chat';
import { useUI } from '../store/ui';
import ComposerBar, { PluginEntry, PluginPopoverSlot } from './ComposerBar';
import { COMPOSER_FOCUS_EVENT, requestComposerFocus } from './focus';
import { menuOptionId, type MenuItem } from './MenuList';
import MentionMenu, { MENTION_TESTID, mentionItems } from './MentionMenu';
import ModelPicker, { getLastTier } from './ModelPicker';
import ScopePicker from './ScopePicker';
import SlashMenu, { SLASH_TESTID, slashItems } from './SlashMenu';

export type ComposerVariant = 'home' | 'chat' | 'branch';

export const PLACEHOLDER: Record<ComposerVariant, string> = {
  home: '问点什么，或拖入论文、课件、代码',
  chat: '继续提问，@ 引用文件与笔记',
  // 规格只给了主页与对话中的文案；分支面板按 UI-05 右栏
  branch: '在分支里继续追问',
};

const LINE_HEIGHT = 23;
const MAX_LINES = 8;
const EMPTY = emptyDraft();

/** 联网开关初值取 settings.web_search_default：每份草稿只套用一次 */
const webDefaultApplied = new Set<string>();
/** 测试用：重新套用联网默认值 */
export function resetComposerDefaults(): void {
  webDefaultApplied.clear();
}

interface Trigger {
  kind: 'mention' | 'slash';
  /** 触发字符（@ 或 /）在文本里的下标 */
  start: number;
  query: string;
}

/** 光标前的文本是否构成 @ 或行首 / 触发 */
function findTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const slash = /(^|\n)\/([^\s/]*)$/.exec(before);
  if (slash) return { kind: 'slash', start: before.length - slash[2].length - 1, query: slash[2] };
  const at = /(^|\s)@([^\s@]*)$/.exec(before);
  if (at) return { kind: 'mention', start: before.length - at[2].length - 1, query: at[2] };
  return null;
}

/** 草稿里还在的 @ 引用 + 附件 → 新的 scope */
function reconcileScope(draft: ComposerDraft, text: string, titleOf: (id: ID) => string | undefined): Scope {
  if (draft.scope.mode !== 'selected') return draft.scope;
  const before = draft.scope.document_ids ?? [];
  const keep = before.filter((id) => {
    if (draft.attachments.includes(id)) return true;
    const t = titleOf(id);
    return t ? text.includes(`@${t}`) : true;
  });
  if (keep.length === before.length) return draft.scope;
  // 删除最后一个 @ 标签后 scope 回到 all（规格 2-艾特-文件引用列表）
  return keep.length === 0 ? { mode: 'all' } : { mode: 'selected', document_ids: keep };
}

/** 背景高亮层：把 `@文件名` 画成小标签 */
function Mirror({ text, titles }: { text: string; titles: string[] }) {
  const parts: ReactNode[] = [];
  if (titles.length === 0) parts.push(text);
  else {
    const esc = titles
      .slice()
      .sort((a, b) => b.length - a.length)
      .map((t) => `@${t}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(esc.join('|'), 'g');
    let last = 0;
    for (const m of text.matchAll(re)) {
      const i = m.index ?? 0;
      parts.push(text.slice(last, i));
      parts.push(
        <mark key={i} className="rounded-[4px] bg-evi-bg text-transparent shadow-[0_0_0_2px_var(--evi-bg)]">
          {m[0]}
        </mark>,
      );
      last = i + m[0].length;
    }
    parts.push(text.slice(last));
  }
  // 末尾换行需要占位，否则高亮层比文本框少一行
  return (
    <>
      {parts}
      {'\u200b'}
    </>
  );
}

export interface ComposerProps {
  variant: ComposerVariant;
  /** 分支面板：当前分支 id（草稿 key）；主页与对话栏为空 */
  branchId?: ID | null;
  /** 当前对话；主页为空，首次发送时先建对话 */
  conversationId?: ID | null;
  /** 新消息接在哪条消息后：对话栏 = active_leaf_id；分支面板 = 分支最后一条消息 */
  parentId?: ID;
  autoFocus?: boolean;
}

export default function Composer({
  variant,
  branchId = null,
  conversationId = null,
  parentId,
  autoFocus,
}: ComposerProps) {
  const key = branchId ?? MAIN;
  const qc = useQueryClient();
  const draft = useChat((s) => s.composer[key] ?? EMPTY);
  const setDraft = useChat((s) => s.setDraft);
  const projectId = useChat((s) => s.projectId);
  const turn = useChat((s) => s.turn);
  const streaming = useChat((s) => s.streaming);
  const settings = useSettings();
  const docsQuery = useDocuments(projectId);
  const skillsQuery = useSkills();
  const popover = useUI((s) => s.popover);

  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [tier, setTier] = useState<ModelTier>(getLastTier);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(0);

  // ---------------------------------------------------------------- 数据
  const allDocs = useMemo(() => (docsQuery.data?.groups ?? []).flatMap((g) => g.documents), [docsQuery.data]);
  /** 可引用的材料：已解析、不含网页快照 */
  const readyDocs = useMemo(() => allDocs.filter((d) => d.parse_status === 'ready' && d.kind !== 'web'), [allDocs]);
  const docById = useMemo(() => new Map(allDocs.map((d) => [d.id, d])), [allDocs]);
  const titleOf = useCallback((id: ID) => docById.get(id)?.title, [docById]);
  const noMaterials = docsQuery.isSuccess && allDocs.filter((d) => d.kind !== 'web').length === 0;
  const selectedIds = draft.scope.mode === 'selected' ? (draft.scope.document_ids ?? []) : [];
  const mentionTitles = selectedIds
    .filter((id) => !draft.attachments.includes(id))
    .map(titleOf)
    .filter((t): t is string => !!t);

  // 联网开关初值
  useEffect(() => {
    if (!settings.data || webDefaultApplied.has(key)) return;
    webDefaultApplied.add(key);
    if (settings.data.web_search_default !== draft.web_search)
      setDraft(key, { web_search: settings.data.web_search_default });
  }, [settings.data, key, draft.web_search, setDraft]);

  // ---------------------------------------------------------------- 状态
  const busy =
    !!turn &&
    !turn.error &&
    turn.connection !== 'lost' &&
    (!streaming || streaming.status === 'streaming' || streaming.status === 'verifying');
  /** 这一轮属于本输入框（同一对话、同一分支）时显示停止键 */
  const mine =
    !!turn && (turn.branch_id ?? null) === branchId && (variant === 'home' || turn.conversation_id === conversationId);
  const hasText = draft.text.trim().length > 0;
  const canSend = hasText && !busy && !creating;

  // ---------------------------------------------------------------- 文本框高度与焦点
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    const min = variant === 'home' ? LINE_HEIGHT * 2 : LINE_HEIGHT;
    el.style.height = '0px';
    const h = Math.min(Math.max(el.scrollHeight, min), LINE_HEIGHT * MAX_LINES);
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > LINE_HEIGHT * MAX_LINES ? 'auto' : 'hidden';
  }, [draft.text, variant]);

  useEffect(() => {
    const onFocus = (e: Event) => {
      const want = (e as CustomEvent<{ variant: ComposerVariant | null }>).detail?.variant;
      if (!want || want === variant) ta.current?.focus();
    };
    window.addEventListener(COMPOSER_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(COMPOSER_FOCUS_EVENT, onFocus);
  }, [variant]);

  // 菜单只在本输入框持有时显示；别处把 popover 换掉就收起
  const menuOpen = !!trigger && popover === trigger.kind;
  useEffect(() => {
    if (trigger && popover !== trigger.kind) setTrigger(null);
  }, [popover, trigger]);

  const items: MenuItem[] = useMemo(() => {
    if (!trigger) return [];
    return trigger.kind === 'mention'
      ? mentionItems(readyDocs, trigger.query)
      : slashItems(skillsQuery.data?.skills ?? [], trigger.query);
  }, [trigger, readyDocs, skillsQuery.data]);

  const openTrigger = (t: Trigger | null) => {
    setTrigger(t);
    setActive(0);
    const ui = useUI.getState();
    if (t) {
      if (ui.popover !== t.kind) useUI.setState({ popover: t.kind });
    } else if (ui.popover === 'mention' || ui.popover === 'slash') useUI.setState({ popover: null });
  };

  // ---------------------------------------------------------------- 编辑
  const writeText = (text: string, caret?: number, extra: Partial<ComposerDraft> = {}) => {
    const next = { ...draft, ...extra };
    setDraft(key, { ...extra, text, scope: reconcileScope(next, text, titleOf) });
    if (caret !== undefined)
      requestAnimationFrame(() => {
        ta.current?.focus();
        ta.current?.setSelectionRange(caret, caret);
      });
  };

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    writeText(text);
    openTrigger(findTrigger(text, e.target.selectionStart ?? text.length));
  };

  const insertMention = (doc: Pick<Document, 'id' | 'title'>, replaceFrom?: number) => {
    const el = ta.current;
    const caret = el?.selectionStart ?? draft.text.length;
    const from = replaceFrom ?? caret;
    const before = draft.text.slice(0, from);
    const after = draft.text.slice(replaceFrom !== undefined ? caret : from);
    const pad = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    const token = `${pad}@${doc.title} `;
    const ids = selectedIds.includes(doc.id) ? selectedIds : [...selectedIds, doc.id];
    const text = before + token + after;
    setDraft(key, { text, scope: { mode: 'selected', document_ids: ids } });
    const pos = (before + token).length;
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
    });
  };

  const pick = (it: MenuItem) => {
    if (!trigger) return;
    if (trigger.kind === 'mention') {
      const doc = docById.get(it.id);
      if (doc) insertMention(doc, trigger.start);
    } else {
      // 去掉行首的 “/查询”，写入 forced_skill（再选会替换）
      const caret = ta.current?.selectionStart ?? draft.text.length;
      const text = draft.text.slice(0, trigger.start) + draft.text.slice(caret);
      const skill = skillsQuery.data?.skills.find((s) => s.id === it.id);
      writeText(text, trigger.start, { forced_skill: skill?.name ?? it.id });
    }
    openTrigger(null);
  };

  /** 引用范围菜单选“只用已选文件”：在光标处插入 @ 并打开列表 */
  const startMention = () => {
    const el = ta.current;
    const caret = el?.selectionStart ?? draft.text.length;
    const before = draft.text.slice(0, caret);
    const pad = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    const text = `${before}${pad}@${draft.text.slice(caret)}`;
    const pos = caret + pad.length + 1;
    setDraft(key, { text });
    openTrigger({ kind: 'mention', start: pos - 1, query: '' });
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
    });
  };

  /** 退格：光标紧跟 @ 标签时整块删除；在最前面时删掉 / Skill 标签 */
  const handleBackspace = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return false;
    const caret = el.selectionStart;
    if (caret === 0 && draft.forced_skill) {
      setDraft(key, { forced_skill: undefined });
      return true;
    }
    const before = draft.text.slice(0, caret);
    for (const t of mentionTitles) {
      for (const tok of [`@${t} `, `@${t}`]) {
        if (before.endsWith(tok)) {
          const start = caret - tok.length;
          writeText(draft.text.slice(0, start) + draft.text.slice(caret), start);
          return true;
        }
      }
    }
    return false;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = Math.max(1, items.length);
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing && items.length > 0) {
        e.preventDefault();
        pick(items[Math.min(active, items.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        openTrigger(null);
        return;
      }
    }
    if (e.key === 'Backspace' && handleBackspace(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (canSend) void submit();
    }
  };

  // ---------------------------------------------------------------- 附件与拖放
  const attachFiles = async (list: FileList | File[]) => {
    const pid = useChat.getState().projectId;
    const { ok, rejected } = splitAccepted(Array.from(list));
    if (rejected.length > 0) useUI.getState().pushToast({ kind: 'error', text: rejectedText(rejected) });
    if (!pid || ok.length === 0) return;
    setUploading((n) => n + 1);
    try {
      const res = await uploadFiles(pid, ok);
      const ids = res.documents.map((d) => d.id);
      const cur = useChat.getState().composer[key] ?? emptyDraft();
      const prevSel = cur.scope.mode === 'selected' ? (cur.scope.document_ids ?? []) : [];
      setDraft(key, {
        attachments: [...cur.attachments, ...ids.filter((id) => !cur.attachments.includes(id))],
        scope: { mode: 'selected', document_ids: [...prevSel, ...ids.filter((id) => !prevSel.includes(id))] },
      });
    } catch (err) {
      useUI.getState().pushToast({ kind: 'error', text: `上传失败：${(err as Error).message}` });
    } finally {
      setUploading((n) => n - 1);
      void qc.invalidateQueries({ queryKey: queryKeys.documents(pid) });
    }
  };

  const removeAttachment = (id: ID) => {
    const attachments = draft.attachments.filter((x) => x !== id);
    const ids = selectedIds.filter((x) => x !== id);
    setDraft(key, {
      attachments,
      scope:
        draft.scope.mode !== 'selected'
          ? draft.scope
          : ids.length
            ? { mode: 'selected', document_ids: ids }
            : { mode: 'all' },
    });
    ta.current?.focus();
  };

  const acceptsDrag = (e: DragEvent) => {
    const types = Array.from(e.dataTransfer?.types ?? []);
    return types.includes(DOC_DRAG_TYPE) || types.includes('Files');
  };
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!acceptsDrag(e)) return;
      e.preventDefault();
      setDragOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!acceptsDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDragOver(false);
    },
    onDrop: (e: DragEvent) => {
      if (!acceptsDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const did = e.dataTransfer.getData(DOC_DRAG_TYPE);
      if (did) {
        // 文件行拖进来：作为 @ 引用加入本轮范围（规格 1-文件分组-文件行「拖到输入框」，U23）
        const doc = docById.get(did);
        if (doc) insertMention(doc, undefined);
        return;
      }
      if (e.dataTransfer.files.length > 0) void attachFiles(e.dataTransfer.files);
    },
  };

  // ---------------------------------------------------------------- 发送 / 停止
  const submit = async () => {
    if (!canSend) return;
    const pending = draft.attachments.map((id) => docById.get(id)).filter((d) => d && d.parse_status !== 'ready');
    if (pending.length > 0) {
      useUI.getState().pushToast({
        kind: 'info',
        text: `${pending.map((d) => d!.title).join('、')} 还在解析，本轮不会检索它`,
      });
    }
    // 项目没有材料：引用范围固定“不用材料”
    if (noMaterials && draft.scope.mode !== 'none') setDraft(key, { scope: { mode: 'none' } });
    const restoreScope = noMaterials && draft.scope.mode !== 'none';
    openTrigger(null);
    const chat = useChat.getState();

    if (variant === 'home') {
      const pid = chat.projectId;
      if (!pid) {
        useUI.getState().pushToast({ kind: 'error', text: '还没有项目，稍后再试' });
        return;
      }
      setCreating(true);
      try {
        const conv = await api.post<Conversation>(`/api/projects/${encodeURIComponent(pid)}/conversations`, {});
        void qc.invalidateQueries({ queryKey: queryKeys.conversations(pid) });
        goConversation(conv.id);
        useChat.getState().send({ conversation_id: conv.id, model_tier: tier });
        requestComposerFocus('chat');
      } catch (err) {
        useUI.getState().pushToast({ kind: 'error', text: `新建对话失败：${(err as Error).message}` });
      } finally {
        setCreating(false);
      }
    } else if (conversationId) {
      const target: Parameters<typeof chat.send>[0] = { conversation_id: conversationId, model_tier: tier };
      if (parentId) target.parent_id = parentId;
      if (variant === 'branch' && branchId) target.branch_id = branchId;
      chat.send(target);
    }
    if (restoreScope) useChat.getState().setDraft(key, { scope: { mode: 'all' } });
  };

  const stop = () => {
    void useChat
      .getState()
      .cancel()
      .catch((err: Error) => useUI.getState().pushToast({ kind: 'error', text: `停止失败：${err.message}` }));
  };

  // ---------------------------------------------------------------- 渲染
  const showStop = busy && mine;
  const sendButton = (
    <button
      type="button"
      data-testid="composer.send"
      data-state={showStop ? 'stop' : canSend ? 'ready' : 'disabled'}
      aria-label={showStop ? '停止生成' : '发送'}
      disabled={!showStop && !canSend}
      onClick={() => (showStop ? stop() : void submit())}
      className={`mn-focus grid flex-none place-items-center rounded-pill text-surface transition-colors ${
        variant === 'branch' ? 'h-7 w-7' : 'h-[34px] w-[34px]'
      } ${showStop || canSend ? 'bg-ink' : 'bg-faint'}`}
    >
      {creating ? <Spinner size={15} /> : showStop ? <StopIcon size={16} /> : <ArrowUpIcon size={17} />}
    </button>
  );

  const attachCards = draft.attachments.length > 0 && (
    <div className="mb-2 flex flex-wrap gap-1.5" data-testid="composer.attachments">
      {draft.attachments.map((id) => {
        const d = docById.get(id);
        const parsing = d && d.parse_status !== 'ready' && d.parse_status !== 'failed';
        return (
          <span
            key={id}
            data-testid={`composer.attach-card:${id}`}
            data-status={d?.parse_status ?? 'unknown'}
            className="inline-flex max-w-[240px] items-center gap-1.5 rounded-btn border border-line bg-panel px-2 py-1 text-[12px] text-ink-2"
          >
            {d ? <TypeBadge doc={d} /> : <Spinner size={12} />}
            <span className="min-w-0 truncate">{d?.title ?? '上传中…'}</span>
            {parsing && <span className="flex-none text-[11px] text-muted">解析 {Math.round(d.progress)}%</span>}
            {d?.parse_status === 'failed' && <span className="flex-none text-[11px] text-danger">解析失败</span>}
            <button
              type="button"
              data-testid={`composer.attach-remove:${id}`}
              aria-label={`从本轮移除 ${d?.title ?? '附件'}`}
              onClick={() => removeAttachment(id)}
              className="mn-focus -mr-0.5 grid h-4 w-4 flex-none place-items-center rounded-btn-sm text-muted hover:text-ink"
            >
              <CloseIcon size={11} />
            </button>
          </span>
        );
      })}
    </div>
  );

  const menu =
    menuOpen &&
    trigger &&
    (trigger.kind === 'mention' ? (
      <MentionMenu
        items={items}
        noMaterials={readyDocs.length === 0}
        active={active}
        onPick={pick}
        onHover={setActive}
      />
    ) : (
      <SlashMenu items={items} active={active} onPick={pick} onHover={setActive} />
    ));

  const textArea = (
    <div className="relative min-w-0 flex-1">
      <div
        ref={mirror}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-[15px] leading-[23px] text-transparent"
      >
        <Mirror text={draft.text} titles={mentionTitles} />
      </div>
      <textarea
        ref={ta}
        // 规格 1-新建对话-主页「验收」：主页输入框自动获得焦点
        autoFocus={autoFocus}
        rows={variant === 'home' ? 2 : 1}
        value={draft.text}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onSelect={(e) => {
          const el = e.currentTarget;
          if (el.selectionStart === el.selectionEnd) {
            const t = findTrigger(el.value, el.selectionStart);
            if (!t && trigger) openTrigger(null);
          }
        }}
        onBlur={() => {
          // 点菜单项用 mousedown.preventDefault 保住焦点；真正离开时收起
          if (trigger) setTimeout(() => document.activeElement !== ta.current && openTrigger(null), 120);
        }}
        placeholder={PLACEHOLDER[variant]}
        aria-label="输入问题"
        aria-autocomplete="list"
        aria-controls={menuOpen ? `${trigger?.kind === 'mention' ? MENTION_TESTID : SLASH_TESTID}-list` : undefined}
        aria-activedescendant={
          menuOpen && items[active]
            ? menuOptionId(trigger?.kind === 'mention' ? MENTION_TESTID : SLASH_TESTID, items[active].id)
            : undefined
        }
        className="relative block w-full resize-none bg-transparent text-[15px] leading-[23px] text-ink outline-none placeholder:text-faint"
      />
    </div>
  );

  const skillTag = draft.forced_skill && (
    <span
      data-testid="composer.skill-tag"
      className="mr-1.5 mt-px inline-flex h-[22px] flex-none items-center rounded-chip bg-panel-2 px-1.5 text-[13px] font-medium text-ink-2"
      title="本轮强制使用该 Skill；在最前面按退格删除"
    >
      /{draft.forced_skill}
    </span>
  );

  const attachButton = (
    <>
      <button
        type="button"
        data-testid="composer.attach"
        aria-label="添加附件"
        title="上传文件到当前项目并加入本轮引用范围"
        onClick={() => fileInput.current?.click()}
        className="mn-focus grid h-7 w-7 flex-none place-items-center rounded-btn-sm text-muted hover:bg-sel hover:text-ink"
      >
        {uploading > 0 ? <Spinner size={15} /> : <PlusIcon size={17} />}
      </button>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="hidden"
        data-testid="composer.attach-input"
        onChange={(e) => {
          if (e.target.files?.length) void attachFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );

  if (variant === 'branch') {
    return (
      <div
        data-testid="composer.box"
        data-variant="branch"
        data-drag={dragOver || undefined}
        {...dropHandlers}
        className={`relative rounded-[13px] border bg-surface px-3 py-2 transition-colors ${
          dragOver ? 'border-ink-2 shadow-[0_0_0_2px_var(--line)]' : 'border-line focus-within:border-faint'
        }`}
      >
        {menu}
        {attachCards}
        <div className="flex items-end gap-2">
          {skillTag}
          {textArea}
          {sendButton}
        </div>
      </div>
    );
  }

  const scope = (
    <ScopePicker
      scope={noMaterials ? { mode: 'none' } : draft.scope}
      disabled={noMaterials}
      selectedTitles={selectedIds.map(titleOf).filter((t): t is string => !!t)}
      withPrefix={variant === 'home'}
      onChange={(s) => setDraft(key, { scope: s })}
      onPickFiles={startMention}
    />
  );

  return (
    <div
      data-testid="composer.box"
      data-variant={variant}
      data-drag={dragOver || undefined}
      {...dropHandlers}
      className={`relative rounded-[18px] border bg-panel-2 p-[5px] transition-shadow ${
        dragOver ? 'border-ink-2 shadow-[0_0_0_2px_var(--line)]' : 'border-line'
      }`}
    >
      <PluginPopoverSlot cid={conversationId} />
      <ComposerBar
        webOn={draft.web_search}
        onToggleWeb={() => setDraft(key, { web_search: !draft.web_search })}
        scope={scope}
        cid={conversationId}
        variant={variant}
      />
      <div className="relative rounded-[13px] border border-line bg-surface px-4 pb-2.5 pt-3 transition-colors focus-within:border-faint">
        {menu}
        {attachCards}
        <div className="flex items-start">
          {skillTag}
          {textArea}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[13px] text-ink-2">
          {attachButton}
          {variant === 'home' && (
            <PluginEntry
              cid={null}
              format="count"
              testid="composer.plugin-entry.inline"
              className="border border-line text-ink-2"
            />
          )}
          <ModelPicker tier={tier} onChange={setTier} />
          <span className="flex-1" />
          {sendButton}
        </div>
      </div>
    </div>
  );
}
