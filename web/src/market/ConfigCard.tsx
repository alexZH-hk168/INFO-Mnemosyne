// 规格：3-插件详情-配置卡（market.plugin-config）
// 显示配置项与 API Key 状态；已安装时可修改配置并重新自检（POST /api/plugins/{id} `{config}`，同安装）。
// 密钥不回显，保存后只显示“已设置”。启动命令与可选参数（manifest command/args）契约 v0.2 的 PluginDetail 未返回，暂不显示（未决 U28）。
import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '../api/client';
import type { PluginDetail } from '../api/types';
import { GearIcon, Spinner } from '../icons/Icons';
import { useUI } from '../store/ui';
import { useInstallPlugin } from './hooks';

export default function ConfigCard({ detail }: { detail: PluginDetail }) {
  const pushToast = useUI((s) => s.pushToast);
  const save = useInstallPlugin(detail.id);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  /** 本次会话里保存过的密钥（只记“已设置”，不记值） */
  const [savedSecrets, setSavedSecrets] = useState<ReadonlySet<string>>(() => new Set());
  const fields = Object.entries(detail.config_schema);
  const installed = detail.status !== 'not_installed';
  const hasSecret = fields.some(([, f]) => f.secret);

  const secretState = (key: string, required: boolean) =>
    !installed ? '安装时填写' : savedSecrets.has(key) || required ? '已设置' : '未设置';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const config = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''));
    save.mutate(config, {
      onSuccess: () => {
        setSavedSecrets((prev) => {
          const next = new Set(prev);
          for (const [k, f] of fields) if (f.secret && config[k]) next.add(k);
          return next;
        });
        setValues({});
        setEditing(false);
        pushToast({ kind: 'success', text: '配置已保存，自检通过' });
      },
    });
  };

  const errorText = save.isError ? save.error.message : null;
  const logTail =
    save.error instanceof ApiRequestError && typeof save.error.details?.log_tail === 'string'
      ? save.error.details.log_tail
      : null;

  return (
    <div data-testid="market.plugin-config" className="rounded-panel border border-line bg-surface px-4 py-3.5">
      <h4 className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <GearIcon size={14} />
        配置
      </h4>
      {fields.length === 0 ? (
        <p data-testid="market.plugin-config.no-key" className="text-[11.5px] leading-[1.6] text-muted">
          此插件不需要 API Key。
        </p>
      ) : !editing ? (
        <>
          <dl className="space-y-1.5">
            {fields.map(([key, f]) => (
              <div key={key} data-testid={`market.plugin-config.field:${key}`} className="text-[12.5px]">
                <dt className="text-muted">
                  {f.label}
                  {!f.required && '（可选）'}
                </dt>
                <dd className="mt-0.5 flex items-center gap-2 rounded-btn bg-[var(--code-bg)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--code-ink)]">
                  {key}
                  <span className="ml-auto font-sans text-[11.5px] text-muted">
                    {f.secret ? secretState(key, f.required) : installed ? '已保存' : '安装时填写'}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          {!hasSecret && <p className="mt-2 text-[11.5px] text-muted">此插件不需要 API Key。</p>}
          {installed && (
            <button
              type="button"
              data-testid="market.plugin-config.edit"
              onClick={() => setEditing(true)}
              className="mn-focus mt-3 rounded-btn border border-line px-3 py-1 text-[12px] text-ink-2 hover:bg-sel"
            >
              修改配置
            </button>
          )}
        </>
      ) : (
        <form onSubmit={submit} className="space-y-2.5">
          {fields.map(([key, f]) => (
            <label key={key} className="block text-[12.5px]">
              <span className="text-muted">
                {f.label}
                {!f.required && '（可选）'}
              </span>
              <input
                data-testid={`market.plugin-config.input:${key}`}
                type={f.secret ? 'password' : 'text'}
                autoComplete={f.secret ? 'new-password' : 'off'}
                value={values[key] ?? ''}
                placeholder={f.secret ? '已设置，留空表示不修改' : ''}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                className="mt-1 w-full rounded-btn border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none placeholder:font-sans placeholder:text-faint focus:border-handle"
              />
            </label>
          ))}
          {errorText && (
            <div role="alert" data-testid="market.plugin-config.error" className="text-[12px] text-danger">
              {errorText}
              {logTail && (
                <pre className="mt-1.5 max-h-[120px] overflow-auto rounded-btn bg-[var(--code-bg)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--code-ink)]">
                  {logTail}
                </pre>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              data-testid="market.plugin-config.cancel"
              onClick={() => {
                setEditing(false);
                setValues({});
                save.reset();
              }}
              className="mn-focus rounded-btn px-2.5 py-1 text-[12px] text-muted hover:bg-sel"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid="market.plugin-config.save"
              disabled={save.isPending}
              className="mn-focus inline-flex items-center gap-1.5 rounded-btn bg-ink px-3 py-1 text-[12px] text-surface disabled:bg-faint"
            >
              {save.isPending && <Spinner size={11} />}
              {save.isPending ? '正在自检…' : '保存并重新自检'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
