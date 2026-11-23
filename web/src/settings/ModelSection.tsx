// 规格：3-设置-模型（settings.model）——设置弹窗“模型”页（v0.5 [BYOK]：用户自带模型密钥）
// 服务商下拉（预设自动填 API 地址与推荐模型名）、API 地址、API Key（只写不读：已设置时显示末 4 位掩码，可修改、可清除）、
// 对话模型 / 小模型 / 嵌入模型、“测试连接”（POST /api/settings/test，保存前不必测试）、顶部模型状态（真实模型 / 演示模式）。
// 保存 = PUT /api/settings，只发改动的字段；API Key 只在填写或清除时发送。
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiRequestError } from '../api/client';
import type { SettingsTestBody, UpdateSettingsBody } from '../api/endpoints';
import { useProviders } from '../api/queries';
import type { ProviderId, ProviderPreset, Settings, SettingsTestResult } from '../api/types';
import { Spinner } from '../icons/Icons';
import { useSaveSettings } from '../market/hooks';
import { AlertIcon } from '../market/icons';
import { useUI } from '../store/ui';

type ModelFields = Pick<Settings, 'api_base' | 'chat_model' | 'small_model' | 'embedding_model'>;
const MODEL_KEYS: (keyof ModelFields)[] = ['api_base', 'chat_model', 'small_model', 'embedding_model'];

const INPUT =
  'mt-1 w-full rounded-btn border border-line bg-surface px-3 py-1.5 font-mono text-[12.5px] text-ink outline-none placeholder:font-sans placeholder:text-faint focus:border-handle';

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] leading-[1.55] text-faint">{hint}</span>}
    </label>
  );
}

/** 测试连接结果里“工具调用 / 嵌入”的中文 */
const TOOLS_TEXT: Record<SettingsTestResult['tool_calls'], string> = {
  supported: '支持工具调用',
  unsupported: '不支持工具调用',
  unknown: '工具调用：无法确认',
};
const EMB_TEXT: Record<SettingsTestResult['embeddings'], string> = {
  supported: '嵌入接口可用',
  unsupported: '该服务商没有嵌入接口',
  unknown: '嵌入：无法确认',
  not_used: '未填嵌入模型',
};

export function ModeBanner({ settings }: { settings: Settings }) {
  if (settings.llm_mode === 'real') {
    return (
      <div
        data-testid="settings.model.mode"
        data-mode="real"
        className="mt-3 rounded-card-sm border border-line bg-canvas px-3.5 py-2.5 text-[12.5px] leading-[1.6] text-ink-2"
      >
        正在使用你自己的模型 <span className="font-mono text-ink">{settings.chat_model}</span>
        。调用费用由你的密钥承担，Mnemosyne 不内置任何付费模型。
      </div>
    );
  }
  if (settings.llm_mode === 'demo' || settings.llm_mode === 'demo_forced') {
    return (
      <div
        data-testid="settings.model.mode"
        data-mode={settings.llm_mode}
        className="mt-3 rounded-card-sm border border-line bg-canvas px-3.5 py-2.5 text-[12.5px] leading-[1.6] text-ink-2"
      >
        <span className="font-medium text-ink">演示模式</span>
        {settings.llm_mode === 'demo_forced'
          ? '：服务端已设置为只用本地示例回答（测试用），这里的配置暂不生效。'
          : '：还没有配置模型，回答由本地示例生成。填好 API 地址、API Key 和对话模型并保存后，自动改用你自己的模型。'}
      </div>
    );
  }
  return null;
}

export default function ModelSection({
  settings,
  renderPage,
}: {
  settings: Settings;
  renderPage: (p: {
    onSubmit: () => void;
    dirty: boolean;
    saving: boolean;
    banner: ReactNode;
    children: ReactNode;
  }) => ReactNode;
}) {
  const save = useSaveSettings();
  const pushToast = useUI((s) => s.pushToast);
  const providers = useProviders();
  const list = useMemo(() => providers.data?.providers ?? [], [providers.data]);

  const pick = (s: Settings): ModelFields => ({
    api_base: s.api_base,
    chat_model: s.chat_model,
    small_model: s.small_model,
    embedding_model: s.embedding_model,
  });
  const [form, setForm] = useState<ModelFields>(() => pick(settings));
  const [provider, setProvider] = useState<ProviderId>(settings.provider ?? 'custom');
  const [editingKey, setEditingKey] = useState(!settings.api_key_set);
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  useEffect(() => {
    setEditingKey(!settings.api_key_set);
    setClearKey(false);
  }, [settings.api_key_set]);

  const preset: ProviderPreset | undefined = useMemo(() => list.find((p) => p.id === provider), [list, provider]);
  const changed = MODEL_KEYS.filter((k) => form[k].trim() !== settings[k]);
  const providerChanged = provider !== (settings.provider ?? 'custom');
  const dirty = changed.length > 0 || providerChanged || apiKey.trim() !== '' || clearKey;

  const choose = (id: ProviderId) => {
    setProvider(id);
    const p = list.find((x) => x.id === id);
    if (p && p.id !== 'custom') {
      setForm({
        api_base: p.api_base,
        chat_model: p.chat_model,
        small_model: p.small_model,
        embedding_model: p.embedding_model,
      });
    }
    test.reset();
  };

  const onSubmit = () => {
    const b: UpdateSettingsBody = {};
    for (const k of changed) b[k] = form[k].trim();
    if (providerChanged) b.provider = provider;
    if (apiKey.trim()) b.api_key = apiKey.trim();
    else if (clearKey) b.api_key = '';
    save.mutate(b, {
      onSuccess: (s) => {
        setApiKey('');
        setClearKey(false);
        setEditingKey(!s.api_key_set); // 换了新 Key 后回到“已设置 ••••abcd”
        pushToast({
          kind: 'success',
          text: s.llm_mode === 'real' ? '模型设置已保存，新消息将使用你的模型' : '模型设置已保存',
        });
      },
    });
  };

  const test = useMutation<SettingsTestResult, Error, SettingsTestBody>({
    mutationFn: (b) => api.post<SettingsTestResult>('/api/settings/test', b),
  });
  const runTest = () => {
    const b: SettingsTestBody = { provider };
    for (const k of MODEL_KEYS) b[k] = form[k].trim();
    if (apiKey.trim()) b.api_key = apiKey.trim();
    test.mutate(b);
  };
  const keyAvailable = !!apiKey.trim() || (settings.api_key_set && !clearKey);
  const canTest = !!form.api_base.trim() && !!form.chat_model.trim() && keyAvailable && !test.isPending;

  const err = save.error;
  const unavailable = err instanceof ApiRequestError && err.code === 'MODEL_UNAVAILABLE';
  const banner = (
    <>
      <ModeBanner settings={settings} />
      {err && (
        <div
          role="alert"
          data-testid={unavailable ? 'settings.dialog.model-unavailable' : 'settings.dialog.error'}
          className="mt-3 flex items-start gap-2 rounded-card-sm bg-[var(--danger-bg)] px-3.5 py-2.5 text-[12.5px] text-danger"
        >
          <AlertIcon size={14} />
          <span>{unavailable ? `已保存，但测试调用失败：${err.message}` : `保存失败：${err.message}`}</span>
        </div>
      )}
    </>
  );

  const noEmbeddings = preset && preset.id !== 'custom' && !preset.supports_embeddings;
  const retrievalHint =
    settings.retrieval_mode === 'embedding'
      ? '检索使用服务端配置的嵌入模型。'
      : '当前检索用本地 BM25 + 本地向量，不调用嵌入接口；这里填的嵌入模型先保存备用。';

  const children = (
    <>
      <Field
        label="服务商"
        hint={
          preset ? (
            <span data-testid="settings.model.provider-notes">
              {preset.notes_zh}
              {preset.doc_urls.length > 0 && (
                <>
                  {' '}
                  <a
                    href={preset.doc_urls[0]}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-ink-2"
                  >
                    官方文档
                  </a>
                </>
              )}
            </span>
          ) : undefined
        }
      >
        <select
          data-testid="settings.model.provider"
          value={provider}
          onChange={(e) => choose(e.target.value as ProviderId)}
          className={`${INPUT} font-sans`}
        >
          {(list.length ? list : [{ id: 'custom', name: '自定义（OpenAI 兼容）' } as ProviderPreset]).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="API 地址" hint="OpenAI 兼容接口，例如 https://<服务地址>/v1">
        <input
          data-testid="settings.dialog.api-base"
          value={form.api_base}
          onChange={(e) => setForm((f) => ({ ...f, api_base: e.target.value }))}
          className={INPUT}
          spellCheck={false}
        />
      </Field>
      <Field label="API Key" hint="只保存在本机后端（文件权限 0600），任何接口都不回传明文">
        {editingKey || clearKey ? (
          <span className="relative mt-1 block">
            <input
              data-testid="settings.dialog.api-key"
              type="password"
              autoComplete="new-password"
              value={apiKey}
              placeholder={
                clearKey ? '保存后清除已存的 Key' : settings.api_key_set ? '输入新的 Key 以替换' : '尚未设置'
              }
              onChange={(e) => {
                setApiKey(e.target.value);
                if (e.target.value) setClearKey(false);
              }}
              className={`${INPUT} mt-0 pr-14`}
            />
            {apiKey && (
              <button
                type="button"
                data-testid="settings.model.api-key-clear-input"
                aria-label="清空输入"
                onClick={() => setApiKey('')}
                className="mn-focus absolute right-2 top-1/2 -translate-y-1/2 rounded-btn-sm px-1.5 text-[12px] text-muted hover:text-ink"
              >
                清空
              </button>
            )}
          </span>
        ) : (
          <span className="mt-1 flex items-center gap-2 rounded-btn border border-line bg-canvas px-3 py-1.5 text-[12.5px] text-ink-2">
            <span data-testid="settings.dialog.api-key-set">已设置</span>
            {settings.api_key_hint && (
              <span data-testid="settings.model.api-key-hint" className="font-mono text-muted">
                {settings.api_key_hint}
              </span>
            )}
            <span className="flex-1" />
            <button
              type="button"
              data-testid="settings.dialog.api-key-edit"
              onClick={() => setEditingKey(true)}
              className="mn-focus rounded-btn-sm text-ink underline underline-offset-2"
            >
              修改
            </button>
            <button
              type="button"
              data-testid="settings.model.api-key-clear"
              onClick={() => setClearKey(true)}
              className="mn-focus rounded-btn-sm text-danger underline underline-offset-2"
            >
              清除
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
            placeholder="留空＝同对话模型"
            onChange={(e) => setForm((f) => ({ ...f, small_model: e.target.value }))}
            className={INPUT}
            spellCheck={false}
          />
        </Field>
        <Field label="嵌入模型">
          <input
            data-testid="settings.dialog.embedding-model"
            value={form.embedding_model}
            placeholder={noEmbeddings ? '该服务商没有嵌入接口' : '可留空'}
            onChange={(e) => setForm((f) => ({ ...f, embedding_model: e.target.value }))}
            className={INPUT}
            spellCheck={false}
          />
        </Field>
      </div>
      <p data-testid="settings.model.retrieval-hint" className="text-[11.5px] leading-[1.6] text-muted">
        对话模型负责回答，需要支持工具调用；小模型用于起标题、整理历史对话等轻量任务。{retrievalHint}
        {noEmbeddings && ' 该服务商没有嵌入接口，嵌入模型留空即可。'}修改后对新发出的消息生效。
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="settings.model.test"
          disabled={!canTest}
          onClick={runTest}
          className="mn-focus inline-flex items-center gap-1.5 rounded-btn border border-line bg-surface px-3 py-1.5 text-[13px] text-ink hover:bg-sel disabled:text-faint disabled:hover:bg-surface"
        >
          {test.isPending && <Spinner size={12} />}
          测试连接
        </button>
        {!canTest && !test.isPending && (
          <span className="text-[11.5px] text-faint">
            填好 API 地址、API Key 和对话模型后可以测试；保存前不必先测试
          </span>
        )}
      </div>
      {test.data && (
        <div
          role="status"
          data-testid="settings.model.test-result"
          data-ok={test.data.ok ? 'true' : 'false'}
          data-code={test.data.code}
          className={`rounded-card-sm px-3.5 py-2.5 text-[12.5px] leading-[1.6] ${
            test.data.ok ? 'border border-line bg-canvas text-ink-2' : 'bg-[var(--danger-bg)] text-danger'
          }`}
        >
          <div className="flex items-start gap-2">
            {!test.data.ok && <AlertIcon size={14} />}
            <span>{test.data.message}</span>
          </div>
          <div className="mt-1 text-[11.5px] text-muted">
            {TOOLS_TEXT[test.data.tool_calls]} · {EMB_TEXT[test.data.embeddings]} · {test.data.latency_ms} ms
          </div>
        </div>
      )}
      {test.error && (
        <p role="alert" data-testid="settings.model.test-error" className="text-[12.5px] text-danger">
          测试失败：{test.error.message}
        </p>
      )}
    </>
  );

  return <>{renderPage({ onSubmit, dirty, saving: save.isPending, banner, children })}</>;
}
