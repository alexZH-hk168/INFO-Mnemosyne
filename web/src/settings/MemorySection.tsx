// 规格：3-设置-记忆管理（settings.memory）
// 设置弹窗里的“记忆”页：记忆开关、画像摘要（只读）、按作用域与主题筛选的记忆条目列表，每条可编辑、删除、查看来源消息。
// 删除前二次确认，文案说明边界：“删除后助手不再使用这条记忆，原始对话仍保留。”
// superseded 条目默认隐藏，勾选“显示历史版本”后以删除线显示并带有效期。无概念图（未决 U7），实现后截图交用户确认。
import { useMemo, useState } from 'react';
import { useMemory, useMemorySummary } from '../api/queries';
import type { MemoryItem, Settings } from '../api/types';
import { Spinner } from '../icons/Icons';
import { tabFor } from '../lib/documents';
import { useDeleteMemory, useSaveSettings, useUpdateMemory } from '../market/hooks';
import ModalFrame from '../market/ModalFrame';
import { useLayout } from '../store/layout';
import { useUI } from '../store/ui';
import Switch from './Switch';

type Scope = MemoryItem['scope'];
const SCOPE_LABEL: Record<Scope, string> = { global: '全局', project: '项目', branch: '分支' };
const SCOPES: (Scope | 'all')[] = ['all', 'global', 'project', 'branch'];

export const DELETE_CONFIRM_TEXT = '删除后助手不再使用这条记忆，原始对话仍保留。';
export const EMPTY_TEXT = '还没有记忆。多聊几轮后这里会出现你学过的主题和易错点。';

const day = (iso?: string) => (iso ? iso.slice(0, 10) : '');

export default function MemorySection({ settings }: { settings: Settings }) {
  const [scope, setScope] = useState<Scope | 'all'>('all');
  const [topic, setTopic] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const scopeFilter = scope === 'all' ? {} : { scope };
  const active = useMemory({ status: 'active', ...scopeFilter });
  const history = useMemory({ status: 'superseded', ...scopeFilter });
  const summary = useMemorySummary();
  const saveSettings = useSaveSettings();
  const pushToast = useUI((s) => s.pushToast);
  const closeModal = useUI((s) => s.closeModal);
  const [confirming, setConfirming] = useState<MemoryItem | null>(null);

  const all = useMemo(
    () => [...(active.data?.items ?? []), ...(showHistory ? (history.data?.items ?? []) : [])],
    [active.data, history.data, showHistory],
  );
  const topics = useMemo(() => [...new Set(all.map((m) => m.topic))], [all]);
  const currentTopic = topic && topics.includes(topic) ? topic : null;
  const shown = all.filter((m) => !currentTopic || m.topic === currentTopic);

  return (
    <div data-testid="settings.memory" className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <h3 className="font-serif text-[17px] font-semibold text-ink">记忆</h3>

        <div className="mt-4 flex items-center gap-3 rounded-card-sm border border-line px-4 py-3">
          <span className="flex-1 text-[13px] text-ink">
            从对话里记住学过的内容
            <span className="block text-[11.5px] text-muted">关闭后不再记新的内容，已有条目保留</span>
          </span>
          {saveSettings.isPending && <Spinner size={12} />}
          <Switch
            testid="settings.memory.enabled"
            label="从对话里记住学过的内容"
            checked={saveSettings.isPending ? !settings.memory_enabled : settings.memory_enabled}
            disabled={saveSettings.isPending}
            onChange={(v) =>
              saveSettings.mutate(
                { memory_enabled: v },
                { onError: (e) => pushToast({ kind: 'error', text: `切换失败：${e.message}` }) },
              )
            }
          />
        </div>

        <section data-testid="settings.memory.summary" className="mt-4">
          <h4 className="text-[12px] text-muted">学习画像（只读，自动生成）</h4>
          <div className="mt-1.5 rounded-card-sm bg-panel px-4 py-3 text-[13px] leading-[1.7] text-ink-2">
            {summary.isPending ? (
              <span className="text-muted">读取中…</span>
            ) : summary.isError ? (
              <span className="text-danger">画像读取失败：{summary.error.message}</span>
            ) : summary.data.content ? (
              <>
                {summary.data.content}
                <span className="mt-1 block text-[11.5px] text-faint">
                  第 {summary.data.version} 版 · 更新于 {day(summary.data.updated_at)}
                </span>
              </>
            ) : (
              <span className="text-muted">暂无画像。</span>
            )}
          </div>
        </section>

        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          {SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`settings.memory.scope:${s}`}
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
              className={`mn-focus rounded-pill border px-2.5 py-0.5 text-[12px] ${
                scope === s ? 'border-ink bg-ink text-surface' : 'border-line text-ink-2 hover:bg-sel'
              }`}
            >
              {s === 'all' ? '全部范围' : SCOPE_LABEL[s]}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
            <input
              type="checkbox"
              data-testid="settings.memory.show-history"
              checked={showHistory}
              onChange={(e) => setShowHistory(e.target.checked)}
              className="mn-focus accent-[var(--ink)]"
            />
            显示历史版本
          </label>
        </div>
        {topics.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="按主题筛选">
            {topics.map((t) => (
              <button
                key={t}
                type="button"
                data-testid={`settings.memory.topic:${t}`}
                aria-pressed={currentTopic === t}
                onClick={() => setTopic(currentTopic === t ? null : t)}
                className={`mn-focus rounded-chip px-2 py-0.5 text-[11.5px] ${
                  currentTopic === t ? 'bg-ink text-surface' : 'bg-panel text-muted hover:bg-sel'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3">
          {active.isPending ? (
            <div className="flex items-center gap-2 py-4 text-[13px] text-muted">
              <Spinner size={13} /> 读取中…
            </div>
          ) : active.isError ? (
            <p role="alert" className="py-4 text-[13px] text-danger">
              条目读取失败：{active.error.message}
            </p>
          ) : shown.length === 0 ? (
            <p data-testid="settings.memory.empty" className="py-6 text-[13px] text-muted">
              {EMPTY_TEXT}
            </p>
          ) : (
            <ul
              data-testid="settings.memory.list"
              className="divide-y divide-line-2 rounded-card-sm border border-line"
            >
              {shown.map((m) => (
                <MemoryRow key={m.id} item={m} onDelete={() => setConfirming(m)} />
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex flex-none items-center justify-end gap-2 border-t border-line px-6 py-3">
        <span className="mr-auto text-[11.5px] text-faint">这一页的改动立即生效</span>
        <button
          type="button"
          data-testid="settings.dialog.close"
          onClick={closeModal}
          className="mn-focus rounded-btn border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-2 hover:bg-sel"
        >
          关闭
        </button>
      </div>
      {confirming && <DeleteConfirm item={confirming} onClose={() => setConfirming(null)} />}
    </div>
  );
}

function MemoryRow({ item, onDelete }: { item: MemoryItem; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.content);
  const update = useUpdateMemory();
  const closeModal = useUI((s) => s.closeModal);
  const superseded = item.status === 'superseded';
  const source = item.source_message_ids[0];

  const viewSource = () => {
    if (!source) return;
    closeModal();
    // 规格：关闭设置，在右栏显示原消息（kind=message 标签，F4 渲染历史对话预览）
    useLayout.getState().openTab(tabFor('message', source, '历史对话'));
  };

  return (
    <li data-testid={`settings.memory.item:${item.id}`} data-status={item.status} className="px-4 py-3">
      <div className="flex items-center gap-2 text-[11.5px] text-muted">
        <span className="rounded-chip bg-panel px-1.5 py-px">{item.topic}</span>
        <span>{SCOPE_LABEL[item.scope]}</span>
        {superseded && (
          <span data-testid={`settings.memory.validity:${item.id}`}>
            有效期 {day(item.valid_from)} – {day(item.valid_to)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2.5">
          {!superseded && !editing && (
            <button
              type="button"
              data-testid={`settings.memory.edit:${item.id}`}
              onClick={() => {
                setText(item.content);
                setEditing(true);
              }}
              className="mn-focus rounded-btn-sm hover:text-ink"
            >
              编辑
            </button>
          )}
          {source && (
            <button
              type="button"
              data-testid={`settings.memory.source:${item.id}`}
              onClick={viewSource}
              className="mn-focus rounded-btn-sm hover:text-ink"
            >
              查看来源
            </button>
          )}
          {!superseded && (
            <button
              type="button"
              data-testid={`settings.memory.delete:${item.id}`}
              onClick={onDelete}
              className="mn-focus rounded-btn-sm hover:text-danger"
            >
              删除
            </button>
          )}
        </span>
      </div>
      {editing ? (
        <form
          className="mt-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim() || update.isPending) return;
            update.mutate({ id: item.id, content: text.trim() }, { onSuccess: () => setEditing(false) });
          }}
        >
          <textarea
            data-testid={`settings.memory.input:${item.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setEditing(false);
              }
            }}
            rows={2}
            autoFocus
            className="w-full resize-y rounded-btn border border-line px-2.5 py-1.5 text-[13px] leading-[1.6] text-ink outline-none focus:border-handle"
          />
          {update.isError && <p className="text-[12px] text-danger">保存失败：{update.error.message}</p>}
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              data-testid={`settings.memory.cancel:${item.id}`}
              onClick={() => setEditing(false)}
              className="mn-focus rounded-btn px-2.5 py-1 text-[12px] text-muted hover:bg-sel"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid={`settings.memory.save:${item.id}`}
              disabled={!text.trim() || update.isPending}
              className="mn-focus inline-flex items-center gap-1 rounded-btn bg-ink px-3 py-1 text-[12px] text-surface disabled:bg-faint"
            >
              {update.isPending && <Spinner size={11} />}
              保存
            </button>
          </div>
        </form>
      ) : (
        <p className={`mt-1 text-[13px] leading-[1.65] ${superseded ? 'text-faint line-through' : 'text-ink-2'}`}>
          {item.content}
        </p>
      )}
    </li>
  );
}

function DeleteConfirm({ item, onClose }: { item: MemoryItem; onClose: () => void }) {
  const del = useDeleteMemory();
  return (
    <ModalFrame
      testid="settings.memory.confirm"
      title="删除这条记忆？"
      onClose={onClose}
      width={400}
      layer="top"
      initialFocus="[data-testid='settings.memory.confirm.cancel']"
    >
      <div className="px-6 pb-5 pt-2">
        <p data-testid="settings.memory.confirm.text" className="text-[13px] leading-[1.7] text-ink-2">
          {DELETE_CONFIRM_TEXT}
        </p>
        <blockquote className="mt-2 rounded-btn bg-panel px-3 py-2 text-[12.5px] text-muted">{item.content}</blockquote>
        {del.isError && (
          <p role="alert" className="mt-2 text-[12px] text-danger">
            删除失败：{del.error.message}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="settings.memory.confirm.cancel"
            onClick={onClose}
            className="mn-focus rounded-btn border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-2 hover:bg-sel"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="settings.memory.confirm.ok"
            disabled={del.isPending}
            onClick={() => del.mutate(item.id, { onSuccess: onClose })}
            className="mn-focus inline-flex items-center gap-1.5 rounded-btn bg-danger px-3.5 py-1.5 text-[13px] text-surface disabled:bg-faint"
          >
            {del.isPending && <Spinner size={12} />}
            删除
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
