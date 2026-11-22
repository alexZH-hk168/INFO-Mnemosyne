// 规格：3-安装-安装确认弹窗（market.install-dialog）
// 三步：① 权限确认（逐项列出 manifest 声明的权限，注明插件自行声明、v1 不做沙箱）② 填配置（config_schema，密钥用密码框；无需配置时跳过）
// ③ 安装并自检（POST /api/plugins/{id}，后端启动 + tools/list）。成功：关闭弹窗；有当前对话时把插件追加到本对话启用列表。
// 失败：红色原因 +“查看日志”（展开 error.details.log_tail）+“重试”。无概念图（未决 U7），实现后截图交用户确认。
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { ApiRequestError } from '../api/client';
import { usePlugin } from '../api/queries';
import { Spinner } from '../icons/Icons';
import { useChat } from '../store/chat';
import { useUI } from '../store/ui';
import { PERMISSION_DOT, PERMISSION_LABEL, PERMISSION_NOTE } from './format';
import { enableInConversation, useInstallPlugin, useMarketItem, useRegistryIndex } from './hooks';
import { AlertIcon, CheckIcon } from './icons';
import Logo from './Logo';
import ModalFrame from './ModalFrame';

type Step = 'permissions' | 'config' | 'install';

export default function InstallDialog() {
  const modal = useUI((s) => s.modal);
  const pluginId = typeof modal?.props?.pluginId === 'string' ? modal.props.pluginId : '';
  return pluginId ? <InstallDialogBody key={pluginId} pluginId={pluginId} /> : null;
}

function InstallDialogBody({ pluginId }: { pluginId: string }) {
  const qc = useQueryClient();
  const closeModal = useUI((s) => s.closeModal);
  const pushToast = useUI((s) => s.pushToast);
  const detail = usePlugin(pluginId);
  const item = useMarketItem('plugin', pluginId);
  const index = useRegistryIndex('plugin', pluginId);
  const install = useInstallPlugin(pluginId);
  const [step, setStep] = useState<Step>('permissions');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [showLog, setShowLog] = useState(false);

  const d = detail.data;
  const name = d?.name ?? item?.name ?? pluginId;
  const fields = useMemo(() => Object.entries(d?.config_schema ?? {}), [d]);
  const needsConfig = fields.length > 0;
  const missing = fields.filter(([k, f]) => f.required && !config[k]?.trim());

  const runInstall = () => {
    setStep('install');
    setShowLog(false);
    install.mutate(config, {
      onSuccess: async () => {
        const cid = useChat.getState().conversationId;
        let enabledHere = false;
        if (cid) {
          try {
            await enableInConversation(qc, cid, pluginId);
            enabledHere = true;
          } catch (e) {
            pushToast({ kind: 'error', text: `已安装，但在本对话启用失败：${(e as Error).message}` });
          }
        }
        pushToast({ kind: 'success', text: enabledHere ? `已安装「${name}」，本对话已启用` : `已安装「${name}」` });
        closeModal();
      },
    });
  };

  const onNext = (e?: FormEvent) => {
    e?.preventDefault();
    if (step === 'permissions') {
      if (needsConfig) setStep('config');
      else runInstall();
    } else if (step === 'config' && missing.length === 0) {
      runInstall();
    }
  };

  const err = install.error;
  const logTail =
    err instanceof ApiRequestError && typeof err.details?.log_tail === 'string' ? err.details.log_tail : null;
  const steps: { key: Step; label: string; skipped?: boolean }[] = [
    { key: 'permissions', label: '权限确认' },
    { key: 'config', label: needsConfig ? '填写配置' : '无需配置', skipped: !needsConfig },
    { key: 'install', label: '安装并自检' },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  return (
    <ModalFrame testid="market.install-dialog" title={`安装 ${name}`} onClose={closeModal} width={480} hideTitle>
      <div className="flex items-center gap-3 px-6 pt-5">
        <Logo name={name} index={index} />
        <div className="min-w-0">
          <div className="font-serif text-[17px] font-semibold text-ink" aria-hidden="true">
            安装 {name}
          </div>
          {item && (
            <div className="text-[12px] text-muted">
              {item.owner} · {item.license}
            </div>
          )}
        </div>
      </div>

      <ol data-testid="market.install-dialog.steps" className="mx-6 mt-4 flex items-center gap-2 text-[12px]">
        {steps.map((s, i) => {
          const done = i < stepIndex;
          const on = i === stepIndex;
          return (
            <li key={s.key} data-step={s.key} data-active={on || undefined} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden="true" className="h-px w-5 bg-line" />}
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-pill text-[11px] ${
                  on ? 'bg-ink text-surface' : done ? 'bg-[var(--done-bg)] text-ok' : 'bg-panel text-muted'
                }`}
              >
                {done ? <CheckIcon size={11} /> : i + 1}
              </span>
              <span className={on ? 'text-ink' : s.skipped ? 'text-faint line-through' : 'text-muted'}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      <form onSubmit={onNext} className="px-6 pb-5 pt-4">
        {detail.isPending && (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted">
            <Spinner size={13} /> 正在读取插件清单…
          </div>
        )}
        {detail.isError && (
          <p role="alert" className="py-4 text-[13px] text-danger">
            读取插件清单失败：{detail.error.message}
          </p>
        )}

        {d && step === 'permissions' && (
          <div data-testid="market.install-dialog.permissions">
            <p className="text-[13px] text-ink-2">安装后，这个插件会获得以下权限：</p>
            <ul className="mt-2 rounded-card-sm border border-line px-3.5 py-2">
              {d.permissions.length === 0 && <li className="py-1 text-[12.5px] text-muted">插件没有声明任何权限。</li>}
              {d.permissions.map((p) => (
                <li
                  key={p}
                  data-testid={`market.install-dialog.permission:${p}`}
                  className="flex items-center gap-2 py-1 text-[12.5px] text-ink-2"
                >
                  <i
                    aria-hidden="true"
                    className="h-[7px] w-[7px] flex-none rounded-pill"
                    style={{ background: PERMISSION_DOT[p] }}
                  />
                  {PERMISSION_LABEL[p]}
                  <code className="ml-auto font-mono text-[11px] text-faint">{p}</code>
                </li>
              ))}
              <li className="flex items-center gap-2 border-t border-line-2 pt-1.5 text-[12.5px] text-muted">
                <i aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-pill bg-[var(--perm-note)]" />
                {PERMISSION_NOTE}
              </li>
            </ul>
            {!d.verified && (
              <p data-testid="market.install-dialog.unverified" className="mt-2 text-[12px] text-muted">
                这个插件未经第一版完整验收（只有 ArXiv 与 Fetch 做了完整验收），安装后可能无法正常调用。
              </p>
            )}
          </div>
        )}

        {d && step === 'config' && (
          <div data-testid="market.install-dialog.config" className="space-y-3">
            {fields.map(([key, f]) => (
              <label key={key} className="block">
                <span className="text-[12px] text-muted">
                  {f.label}
                  {f.required ? <span className="text-danger"> *</span> : '（可选）'}
                </span>
                <input
                  data-testid={`market.install-dialog.field:${key}`}
                  type={f.secret ? 'password' : 'text'}
                  autoComplete={f.secret ? 'new-password' : 'off'}
                  value={config[key] ?? ''}
                  onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))}
                  className="mt-1 w-full rounded-btn border border-line bg-surface px-3 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-handle"
                />
                <span className="mt-0.5 block font-mono text-[11px] text-faint">{key}</span>
              </label>
            ))}
          </div>
        )}

        {step === 'install' && (
          <div data-testid="market.install-dialog.check" aria-live="polite">
            {install.isPending && (
              <div
                data-testid="market.install-dialog.checking"
                className="flex items-center gap-2 rounded-card-sm bg-panel px-3.5 py-3 text-[13px] text-ink-2"
              >
                <Spinner size={14} />
                <span>
                  正在启动并检查工具…<span className="ml-1 text-muted">通常需要 5–30 秒</span>
                </span>
              </div>
            )}
            {install.isError && (
              <div data-testid="market.install-dialog.failed" role="alert">
                <div className="flex items-start gap-2 rounded-card-sm bg-[var(--danger-bg)] px-3.5 py-3 text-[13px] text-danger">
                  <AlertIcon size={15} />
                  <span>{err?.message ?? '安装失败'}</span>
                </div>
                {logTail && (
                  <button
                    type="button"
                    data-testid="market.install-dialog.show-log"
                    aria-expanded={showLog}
                    onClick={() => setShowLog((s) => !s)}
                    className="mn-focus mt-2 rounded-btn-sm text-[12px] text-ink-2 underline underline-offset-2"
                  >
                    {showLog ? '收起日志' : '查看日志'}
                  </button>
                )}
                {showLog && logTail && (
                  <pre
                    data-testid="market.install-dialog.log"
                    className="mt-2 max-h-[180px] overflow-auto rounded-card-sm bg-[var(--code-bg)] px-3 py-2 font-mono text-[11.5px] leading-[1.6] text-[var(--code-ink)]"
                  >
                    {logTail}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {step === 'config' && (
            <button
              type="button"
              data-testid="market.install-dialog.back"
              onClick={() => setStep('permissions')}
              className="mn-focus mr-auto rounded-btn px-2 py-1.5 text-[13px] text-muted hover:bg-sel hover:text-ink"
            >
              上一步
            </button>
          )}
          <button
            type="button"
            data-testid="market.install-dialog.cancel"
            onClick={closeModal}
            className="mn-focus rounded-btn border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-2 hover:bg-sel"
          >
            {step === 'install' && install.isError ? '关闭' : '取消'}
          </button>
          {step !== 'install' && (
            <button
              type="submit"
              data-testid="market.install-dialog.next"
              disabled={!d || (step === 'config' && missing.length > 0)}
              className="mn-focus rounded-btn bg-ink px-3.5 py-1.5 text-[13px] text-surface disabled:bg-faint"
            >
              {step === 'permissions' && needsConfig ? '下一步' : '安装'}
            </button>
          )}
          {step === 'install' && install.isError && (
            <button
              type="button"
              data-testid="market.install-dialog.retry"
              onClick={runInstall}
              className="mn-focus rounded-btn bg-ink px-3.5 py-1.5 text-[13px] text-surface"
            >
              重试
            </button>
          )}
        </div>
      </form>
    </ModalFrame>
  );
}
