// 规格：3-插件详情-配置卡（market.plugin-config）
// 显示启动命令（契约 v0.3 `PluginDetail.manifest`）、配置项与 API Key 状态；已安装时可修改配置并重新自检
// （POST /api/plugins/{id} `{config}`，同安装）。契约 v0.3：未提供的键沿用已存值，空字符串表示清除。
// 密钥只写不读：状态取 `config_set`（只有键名），非密钥的当前值取 `config`。
import { useMemo, useState, type FormEvent } from 'react';
import { ApiRequestError } from '../api/client';
import type { PluginDetail } from '../api/types';
import { GearIcon, Spinner } from '../icons/Icons';
import { useUI } from '../store/ui';
import { commandLine } from './format';
import { useInstallPlugin } from './hooks';

const CODE =
  'rounded-btn border border-line-2 bg-[var(--code-bg)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--code-ink)]';

export default function ConfigCard({ detail }: { detail: PluginDetail }) {
  const pushToast = useUI((s) => s.pushToast);
  const save = useInstallPlugin(detail.id);
  const fields = Object.entries(detail.config_schema);
  const installed = detail.status !== 'not_installed';
  const hasSecret = fields.some(([, f]) => f.secret);
  const isSet = (key: string, required: boolean) =>
    detail.config_set ? detail.config_set.includes(key) : installed && required; // 旧后端无 config_set 时按必填推断
  const currentValue = (key: string) => {
    const v = detail.config?.[key];
    return v === undefined ? '' : String(v);
  };
  const initial = useMemo(
    () => Object.fromEntries(fields.filter(([, f]) => !f.secret).map(([k]) => [k, currentValue(k)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail],
  );

  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [cleared, setCleared] = useState<ReadonlySet<string>>(() => new Set());

  /** 只发改动过的键：非密钥与原值不同（空串＝清除）；密钥有输入才发，点了“清除”发空串 */
  const changes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, f] of fields) {
      const v = (values[k] ?? '').trim();
      if (f.secret) {
        if (v) out[k] = v;
        else if (cleared.has(k)) out[k] = '';
      } else if (v !== (initial[k] ?? '')) {
        out[k] = v;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, cleared, initial]);
  const dirty = Object.keys(changes).length > 0;

  const reset = () => {
    setValues(initial);
    setCleared(new Set());
    save.reset();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || save.isPending) return;
    save.mutate(changes, {
      onSuccess: () => {
        setEditing(false);
        setValues({});
        setCleared(new Set());
        pushToast({ kind: 'success', text: '配置已保存，自检通过' });
      },
    });
  };

  const errorText = save.isError ? save.error.message : null;
  const logTail =
    save.error instanceof ApiRequestError && typeof save.error.details?.log_tail === 'string'
      ? save.error.details.log_tail
      : null;

  const status = (key: string, f: PluginDetail['config_schema'][string]) => {
    if (!installed) return '安装时填写';
    if (f.secret) return isSet(key, f.required) ? '已设置' : '未设置';
    return currentValue(key) || '未设置';
  };

  return (
    <div data-testid="market.plugin-config" className="rounded-panel border border-line bg-surface px-4 py-3.5">
      <h4 className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <GearIcon size={14} />
        配置
      </h4>

      {detail.manifest && (
        <div className="mb-2.5 text-[12.5px]">
          <div className="text-muted">启动命令（{detail.manifest.transport}）</div>
          <div data-testid="market.plugin-config.command" className={`mt-1 break-all ${CODE}`}>
            {commandLine(detail.manifest)}
          </div>
        </div>
      )}

      {fields.length > 0 && !editing && (
        <dl className="space-y-1.5">
          {fields.map(([key, f]) => (
            <div key={key} data-testid={`market.plugin-config.field:${key}`} className="text-[12.5px]">
              <dt className="text-muted">
                {f.label}
                {!f.required && '（可选）'}
              </dt>
              <dd className={`mt-1 flex items-center gap-2 ${CODE}`}>
                <span className="min-w-0 truncate">{f.secret || !installed ? key : status(key, f)}</span>
                {(f.secret || !installed) && (
                  <span className="ml-auto flex-none font-sans text-[11.5px] text-muted">{status(key, f)}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {editing && (
        <form onSubmit={submit} className="space-y-2.5">
          {fields.map(([key, f]) => {
            const set = f.secret && isSet(key, f.required) && !cleared.has(key);
            return (
              <label key={key} className="block text-[12.5px]">
                <span className="flex items-center text-muted">
                  {f.label}
                  {!f.required && '（可选）'}
                  {f.secret && !f.required && set && (
                    <button
                      type="button"
                      data-testid={`market.plugin-config.clear:${key}`}
                      onClick={() => {
                        setCleared((c) => new Set(c).add(key));
                        setValues((v) => ({ ...v, [key]: '' }));
                      }}
                      className="mn-focus ml-auto rounded-btn-sm text-[11.5px] text-muted underline-offset-2 hover:text-danger hover:underline"
                    >
                      清除
                    </button>
                  )}
                </span>
                <input
                  data-testid={`market.plugin-config.input:${key}`}
                  type={f.secret ? 'password' : 'text'}
                  autoComplete={f.secret ? 'new-password' : 'off'}
                  value={values[key] ?? ''}
                  placeholder={
                    f.secret ? (set ? '已设置，留空表示不修改' : cleared.has(key) ? '保存后清除' : '未设置') : ''
                  }
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  className="mt-1 w-full rounded-btn border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none placeholder:font-sans placeholder:text-faint focus:border-handle"
                />
              </label>
            );
          })}
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
                reset();
              }}
              className="mn-focus rounded-btn px-2.5 py-1 text-[12px] text-muted hover:bg-sel"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid="market.plugin-config.save"
              disabled={!dirty || save.isPending}
              className="mn-focus inline-flex items-center gap-1.5 rounded-btn bg-ink px-3 py-1 text-[12px] text-surface disabled:bg-faint"
            >
              {save.isPending && <Spinner size={11} />}
              {save.isPending ? '正在自检…' : '保存并重新自检'}
            </button>
          </div>
        </form>
      )}

      {!hasSecret && (
        <p data-testid="market.plugin-config.no-key" className="mt-2 text-[11.5px] leading-[1.6] text-muted">
          此插件不需要 API Key。
        </p>
      )}

      {installed && fields.length > 0 && !editing && (
        <button
          type="button"
          data-testid="market.plugin-config.edit"
          onClick={() => {
            reset();
            setEditing(true);
          }}
          className="mn-focus mt-3 rounded-btn border border-line px-3 py-1 text-[12px] text-ink-2 hover:bg-sel"
        >
          修改配置
        </button>
      )}
    </div>
  );
}
