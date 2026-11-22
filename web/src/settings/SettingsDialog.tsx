// 规格：2-用户卡片-设置弹窗（settings.dialog）
// 大弹窗，左侧导航：模型、检索、记忆。模型页填 API 地址、Key、对话模型、小模型、嵌入模型；检索页设联网检索默认值；
// 记忆页见 3-设置-记忆管理。保存 = PUT /api/settings（只发当前页改动的字段），API Key 只写不读。
// 无概念图（未决 U7），实现后截图交用户确认。
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiRequestError } from '../api/client';
import type { UpdateSettingsBody } from '../api/endpoints';
import { useSettings } from '../api/queries';
import type { Settings } from '../api/types';
import { Spinner } from '../icons/Icons';
import { useSaveSettings } from '../market/hooks';
import { AlertIcon } from '../market/icons';
import ModalFrame from '../market/ModalFrame';
import { useUI } from '../store/ui';
import MemorySection from './MemorySection';
import Switch from './Switch';

export type Section = 'model' | 'search' | 'memory';
const NAV: { key: Section; label: string }[] = [
  { key: 'model', label: '模型' },
  { key: 'search', label: '检索' },
  { key: 'memory', label: '记忆' },
];

export default function SettingsDialog() {
  const closeModal = useUI((s) => s.closeModal);
  const modal = useUI((s) => s.modal);
  const initial = modal?.props?.section;
  const [section, setSection] = useState<Section>(initial === 'search' || initial === 'memory' ? initial : 'model');
  const settings = useSettings();

  return (
    <ModalFrame
      testid="settings.dialog"
      title="设置"
      onClose={closeModal}
      width={760}
      hideTitle
      className="flex h-[560px] flex-col"
    >
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="设置分类"
          className="flex w-[168px] flex-none flex-col gap-0.5 border-r border-line bg-panel px-2.5 py-4"
        >
          <div aria-hidden="true" className="px-2.5 pb-3 font-serif text-[17px] font-semibold text-ink">
            设置
          </div>
          {NAV.map((n) => (
            <button
              key={n.key}
              type="button"
              data-testid={`settings.dialog.nav:${n.key}`}
              aria-current={section === n.key ? 'page' : undefined}
              onClick={() => setSection(n.key)}
              className={`mn-focus rounded-btn px-2.5 py-1.5 text-left text-[13px] ${
                section === n.key ? 'bg-sel text-ink' : 'text-ink-2 hover:bg-sel'
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {settings.isPending ? (
            <div className="flex items-center gap-2 p-6 text-[13px] text-muted">
              <Spinner size={13} /> 正在读取设置…
            </div>
          ) : settings.isError ? (
            <div role="alert" data-testid="settings.dialog.load-error" className="p-6 text-[13px] text-ink-2">
              设置加载失败：{settings.error.message} ·{' '}
              <button
                type="button"
                onClick={() => void settings.refetch()}
                className="mn-focus underline underline-offset-2"
              >
                重试
              </button>
            </div>
          ) : section === 'model' ? (
            <ModelSection key="model" settings={settings.data} onClose={closeModal} />
          ) : section === 'search' ? (
            <SearchSection key="search" settings={settings.data} onClose={closeModal} />
          ) : (
            <MemorySection settings={settings.data} />
          )}
        </div>
      </div>
    </ModalFrame>
  );
}

/** 页面骨架：标题 + 内容 + 底部按钮（关闭 / 保存） */
function Page({
  testid,
  title,
  children,
  onSubmit,
  onClose,
  dirty,
  saving,
  banner,
}: {
  testid: string;
  title: string;
  children: ReactNode;
  onSubmit: () => void;
  onClose: () => void;
  dirty: boolean;
  saving: boolean;
  banner?: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty && !saving) onSubmit();
  };
  return (
    <form data-testid={testid} onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <h3 className="font-serif text-[17px] font-semibold text-ink">{title}</h3>
        {banner}
        <div className="mt-4 space-y-4">{children}</div>
      </div>
      <div className="flex flex-none justify-end gap-2 border-t border-line px-6 py-3">
        <button
          type="button"
          data-testid="settings.dialog.close"
          onClick={onClose}
          className="mn-focus rounded-btn border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-2 hover:bg-sel"
        >
          关闭
        </button>
        <button
          type="submit"
          data-testid="settings.dialog.save"
          disabled={!dirty || saving}
          className="mn-focus inline-flex min-w-[64px] items-center justify-center gap-1.5 rounded-btn bg-ink px-3.5 py-1.5 text-[13px] text-surface disabled:bg-faint"
        >
          {saving && <Spinner size={12} />}
          保存
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-faint">{hint}</span>}
    </label>
  );
}

const INPUT =
  'mt-1 w-full rounded-btn border border-line bg-surface px-3 py-1.5 font-mono text-[12.5px] text-ink outline-none placeholder:font-sans placeholder:text-faint focus:border-handle';

type ModelFields = Pick<Settings, 'api_base' | 'chat_model' | 'small_model' | 'embedding_model'>;
const MODEL_KEYS: (keyof ModelFields)[] = ['api_base', 'chat_model', 'small_model', 'embedding_model'];

function ModelSection({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const save = useSaveSettings();
  const pushToast = useUI((s) => s.pushToast);
  const pick = (s: Settings): ModelFields => ({
    api_base: s.api_base,
    chat_model: s.chat_model,
    small_model: s.small_model,
    embedding_model: s.embedding_model,
  });
  const [form, setForm] = useState<ModelFields>(() => pick(settings));
  const [editingKey, setEditingKey] = useState(!settings.api_key_set);
  const [apiKey, setApiKey] = useState('');
  useEffect(() => setEditingKey(!settings.api_key_set), [settings.api_key_set]);

  const changed = MODEL_KEYS.filter((k) => form[k].trim() !== settings[k]);
  const dirty = changed.length > 0 || apiKey.trim() !== '';

  const onSubmit = () => {
    const b: UpdateSettingsBody = {};
    for (const k of changed) b[k] = form[k].trim();
    if (apiKey.trim()) b.api_key = apiKey.trim();
    save.mutate(b, {
      onSuccess: () => {
        setApiKey('');
        pushToast({ kind: 'success', text: '模型设置已保存' });
      },
    });
  };

  const err = save.error;
  const unavailable = err instanceof ApiRequestError && err.code === 'MODEL_UNAVAILABLE';

  return (
    <Page
      testid="settings.dialog.model"
      title="模型"
      onSubmit={onSubmit}
      onClose={onClose}
      dirty={dirty}
      saving={save.isPending}
      banner={
        err ? (
          <div
            role="alert"
            data-testid={unavailable ? 'settings.dialog.model-unavailable' : 'settings.dialog.error'}
            className="mt-3 flex items-start gap-2 rounded-card-sm bg-[var(--danger-bg)] px-3.5 py-2.5 text-[12.5px] text-danger"
          >
            <AlertIcon size={14} />
            <span>{unavailable ? `已保存，但测试调用失败：${err.message}` : `保存失败：${err.message}`}</span>
          </div>
        ) : null
      }
    >
      <Field label="API 地址" hint="OpenAI 兼容接口，例如 https://<服务地址>/v1">
        <input
          data-testid="settings.dialog.api-base"
          value={form.api_base}
          onChange={(e) => setForm((f) => ({ ...f, api_base: e.target.value }))}
          className={INPUT}
          spellCheck={false}
        />
      </Field>
      <Field label="API Key" hint="只保存在本机后端，不会在界面上回显">
        {editingKey ? (
          <input
            data-testid="settings.dialog.api-key"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            placeholder={settings.api_key_set ? '输入新的 Key 以替换' : '尚未设置'}
            onChange={(e) => setApiKey(e.target.value)}
            className={INPUT}
          />
        ) : (
          <span className="mt-1 flex items-center gap-2 rounded-btn border border-line bg-canvas px-3 py-1.5 text-[12.5px] text-ink-2">
            <span data-testid="settings.dialog.api-key-set">已设置</span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              data-testid="settings.dialog.api-key-edit"
              onClick={() => setEditingKey(true)}
              className="mn-focus rounded-btn-sm text-ink underline underline-offset-2"
            >
              修改
            </button>
          </span>
        )}
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="对话模型">
          <input
            data-testid="settings.dialog.chat-model"
            value={form.chat_model}
            onChange={(e) => setForm((f) => ({ ...f, chat_model: e.target.value }))}
            className={INPUT}
            spellCheck={false}
          />
        </Field>
        <Field label="小模型">
          <input
            data-testid="settings.dialog.small-model"
            value={form.small_model}
            onChange={(e) => setForm((f) => ({ ...f, small_model: e.target.value }))}
            className={INPUT}
            spellCheck={false}
          />
        </Field>
        <Field label="嵌入模型">
          <input
            data-testid="settings.dialog.embedding-model"
            value={form.embedding_model}
            onChange={(e) => setForm((f) => ({ ...f, embedding_model: e.target.value }))}
            className={INPUT}
            spellCheck={false}
          />
        </Field>
      </div>
      <p className="text-[11.5px] leading-[1.6] text-muted">
        对话模型负责回答；小模型用于起标题、抽取要点等轻量任务；嵌入模型用于检索材料。修改后对新发出的消息生效。
      </p>
    </Page>
  );
}

function SearchSection({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const save = useSaveSettings();
  const pushToast = useUI((s) => s.pushToast);
  const [web, setWeb] = useState(settings.web_search_default);
  const dirty = web !== settings.web_search_default;
  return (
    <Page
      testid="settings.dialog.search"
      title="检索"
      onSubmit={() =>
        save.mutate(
          { web_search_default: web },
          { onSuccess: () => pushToast({ kind: 'success', text: '检索设置已保存' }) },
        )
      }
      onClose={onClose}
      dirty={dirty}
      saving={save.isPending}
      banner={
        save.isError ? (
          <p role="alert" data-testid="settings.dialog.error" className="mt-3 text-[12.5px] text-danger">
            保存失败：{save.error.message}
          </p>
        ) : null
      }
    >
      <div className="flex items-center gap-3 rounded-card-sm border border-line px-4 py-3">
        <span className="flex-1 text-[13px] text-ink">
          新对话默认开启联网检索
          <span className="block text-[11.5px] text-muted">每次提问时仍可在输入框里单独开关</span>
        </span>
        <Switch testid="settings.dialog.web-search" label="新对话默认开启联网检索" checked={web} onChange={setWeb} />
      </div>
    </Page>
  );
}
