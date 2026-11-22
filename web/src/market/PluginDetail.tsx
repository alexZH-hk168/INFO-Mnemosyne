// 规格：3-条目卡片-插件详情页（market.plugin-detail）、3-插件详情-卸载（market.uninstall）
// 面包屑“插件与 Skill › 插件市场 › 名称”；左：用途、提供的工具表、“在 Mnemosyne 里怎么用”；右：安装按钮、配置卡、权限卡、来源卡、卸载。
// 数据：['plugin', id]（未安装时后端返回 manifest 与上游工具清单，status=not_installed）＋ ['market','plugins'] 里的条目（作者、星数、许可证、类别、仓库）。
import { useState } from 'react';
import { usePlugin } from '../api/queries';
import type { PluginDetail as PluginDetailData } from '../api/types';
import { GlobeIcon, Spinner } from '../icons/Icons';
import type { MarketRoute } from '../store/layout';
import { useUI } from '../store/ui';
import ConfigCard from './ConfigCard';
import { displayRepo, formatStarsFull, PERMISSION_DOT, PERMISSION_NOTE, permissionText, starsTooltip } from './format';
import { useInstallPlugin, useMarketItem, useRegistryIndex, useUninstallPlugin } from './hooks';
import { AlertIcon, LayersIcon, StarIcon } from './icons';
import InstallButton from './InstallButton';
import Logo, { CategoryTag, OfficialTag } from './Logo';
import { backToList } from './marketNav';
import ModalFrame from './ModalFrame';
import ToolTable from './ToolTable';
import { Breadcrumbs, DetailError, DetailLoading, SidePanel } from './DetailParts';

export default function PluginDetail({ id, tab }: { id: string; tab: MarketRoute['tab'] }) {
  const detail = usePlugin(id);
  const item = useMarketItem('plugin', id);
  const index = useRegistryIndex('plugin', id);
  const listTab: MarketRoute['tab'] = tab === 'installed' ? 'installed' : 'plugins';
  const d = detail.data;
  const name = d?.name ?? item?.name ?? id;
  const allow = d?.manifest?.tools_allow;
  const offCount = d && allow ? d.tools.filter((t) => !allow.includes(t.name)).length : 0;

  return (
    <div data-testid="market.plugin-detail" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <Breadcrumbs tab={listTab} name={name} />
      {detail.isPending ? (
        <DetailLoading />
      ) : detail.isError ? (
        <DetailError
          message={detail.error.message}
          onRetry={() => void detail.refetch()}
          onBack={() => backToList(listTab)}
        />
      ) : (
        d && (
          <>
            {d.status === 'error' && <ErrorBar detail={d} />}
            <div className="flex gap-7 px-9 pb-5 pt-[22px]">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-4">
                  <Logo name={name} index={index} size="lg" />
                  <div className="min-w-0">
                    <h2 className="font-serif text-[24px] font-semibold text-ink">{name}</h2>
                    {item && (
                      <div className="mt-[3px] flex flex-wrap items-center gap-2.5 text-[12.5px] text-muted">
                        <span>{item.owner}</span>
                        <OfficialTag official={item.official} />
                        <span title={starsTooltip(item)} className="inline-flex items-center gap-1">
                          <StarIcon />
                          {formatStarsFull(item.stars)}
                        </span>
                        <span>{item.license}</span>
                        <CategoryTag category={item.category} />
                      </div>
                    )}
                  </div>
                </div>
                {(d.about_zh || item) && (
                  <p
                    data-testid="market.plugin-detail.lead"
                    className="mb-[18px] mt-4 text-[14px] leading-[1.8] text-ink-2"
                  >
                    {d.about_zh ?? `${item?.desc_zh}。`}
                  </p>
                )}

                <h3 className="mb-2 mt-[18px] flex flex-wrap items-baseline gap-2 text-[13px] font-semibold text-ink">
                  提供的工具
                  <span className="text-[11.5px] font-normal text-muted">
                    安装后以 {d.id}__ 前缀出现在助手的工具清单里
                    {d.tools.length > 0 && ` · 共 ${d.tools.length} 个${d.tools.length > 8 ? '，列出常用 8 个' : ''}`}
                    {offCount > 0 && `；${offCount} 个未启用`}
                  </span>
                </h3>
                {d.tools.length > 0 ? (
                  <ToolTable tools={d.tools} allow={d.manifest?.tools_allow} />
                ) : (
                  <p
                    data-testid="market.plugin-tools.empty"
                    className="rounded-card border border-line px-3.5 py-3 text-[12.5px] text-muted"
                  >
                    工具清单要等后端启动插件、完成 tools/list 后才能列出。
                  </p>
                )}

                <h3 className="mb-2 mt-[18px] text-[13px] font-semibold text-ink">在 Mnemosyne 里怎么用</h3>
                <p data-testid="market.plugin-detail.usage" className="text-[13px] leading-[1.8] text-ink-2">
                  {d.usage_zh ??
                    '安装后插件默认在当前对话启用。提问时助手会按需调用上面的工具，工具结果会作为证据出现在回答里，可以点开核对；不想用时，在输入框的“插件”弹层里按对话关掉它即可。'}
                </p>
              </div>

              <aside className="flex w-[340px] flex-none flex-col gap-3.5">
                {item && <InstallButton item={{ ...item, installed: d.status !== 'not_installed' }} variant="detail" />}
                <ConfigCard key={`${d.id}:${d.status}`} detail={d} />
                <SidePanel testid="market.plugin-detail.permissions" icon={<LayersIcon />} title="需要的权限">
                  <ul>
                    {d.permissions.length === 0 && (
                      <li className="py-[5px] text-[12.5px] text-muted">插件没有声明任何权限</li>
                    )}
                    {d.permissions.map((p) => (
                      <li key={p} className="flex items-center gap-2 py-[5px] text-[12.5px] text-ink-2">
                        <i
                          aria-hidden="true"
                          className="h-[7px] w-[7px] flex-none rounded-pill"
                          style={{ background: PERMISSION_DOT[p] }}
                        />
                        {permissionText(p, d.permission_notes)}
                        <code className="ml-auto font-mono text-[11px] text-faint">{p}</code>
                      </li>
                    ))}
                    <li
                      data-testid="market.plugin-detail.permission-note"
                      className="flex items-center gap-2 py-[5px] text-[12.5px] text-ink-2"
                    >
                      <i aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-pill bg-[var(--perm-note)]" />
                      {PERMISSION_NOTE}
                    </li>
                  </ul>
                </SidePanel>
                <SidePanel testid="market.plugin-detail.source" icon={<GlobeIcon size={14} />} title="来源">
                  {item ? (
                    <dl className="text-[12.5px]">
                      <div className="flex justify-between gap-3 py-1">
                        <dt className="text-muted">仓库</dt>
                        <dd className="min-w-0 truncate">
                          <a
                            href={item.repo_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mn-focus text-ink-2 hover:underline"
                          >
                            {displayRepo(item.repo_url)}
                          </a>
                        </dd>
                      </div>
                      <div className="flex justify-between py-1">
                        <dt className="text-muted">许可证</dt>
                        <dd className="text-ink-2">{item.license}</dd>
                      </div>
                      <div className="flex justify-between py-1">
                        <dt className="text-muted">星数</dt>
                        <dd className="text-ink-2" title="所属仓库星数">
                          {formatStarsFull(item.stars)}（{item.stars_date}）
                        </dd>
                      </div>
                      <div className="flex justify-between py-1">
                        <dt className="text-muted">验收</dt>
                        <dd data-testid="market.plugin-detail.verified" className="text-ink-2">
                          {d.verified ? '已验收' : '未验收'}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-[12.5px] text-muted">不在市场清单里。</p>
                  )}
                </SidePanel>
                {d.status !== 'not_installed' && <UninstallButton id={d.id} name={name} />}
              </aside>
            </div>
          </>
        )
      )}
    </div>
  );
}

/** status=error：顶部红色条＋“重新检查” */
function ErrorBar({ detail }: { detail: PluginDetailData }) {
  const recheck = useInstallPlugin(detail.id);
  return (
    <div
      data-testid="market.plugin-detail.error-bar"
      role="alert"
      className="mx-9 mt-3 flex items-center gap-2 rounded-card-sm bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-danger"
    >
      <AlertIcon size={15} />
      <span className="flex-1">
        插件上次自检失败{detail.last_check_at ? `（${detail.last_check_at.slice(0, 16).replace('T', ' ')}）` : ''}
        ，对话里暂时不可用。
        {recheck.isError && ` ${recheck.error.message}`}
      </span>
      <button
        type="button"
        data-testid="market.plugin-detail.recheck"
        disabled={recheck.isPending}
        onClick={() => recheck.mutate({})}
        className="mn-focus inline-flex items-center gap-1.5 rounded-btn border border-danger px-2.5 py-1 text-[12px] text-danger hover:bg-surface"
      >
        {recheck.isPending && <Spinner size={11} />}
        重新检查
      </button>
    </div>
  );
}

/** 已安装插件详情底部“卸载”文字按钮，二次确认 */
function UninstallButton({ id, name }: { id: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const uninstall = useUninstallPlugin(id);
  const pushToast = useUI((s) => s.pushToast);
  return (
    <>
      <button
        type="button"
        data-testid="market.uninstall"
        onClick={() => setConfirming(true)}
        className="mn-focus self-start rounded-btn-sm px-1 text-[12.5px] text-muted underline-offset-2 hover:text-danger hover:underline"
      >
        卸载
      </button>
      {confirming && (
        <ModalFrame
          testid="market.uninstall.confirm"
          title={`卸载 ${name}？`}
          onClose={() => setConfirming(false)}
          width={400}
          initialFocus="[data-testid='market.uninstall.cancel']"
        >
          <div className="px-6 pb-5 pt-2">
            <p className="text-[13px] leading-[1.7] text-ink-2">
              会停止插件进程并删除它的配置，所有对话里这个插件的开关都会消失。已经产生的证据与网页快照会保留。
            </p>
            {uninstall.isError && (
              <p role="alert" className="mt-2 text-[12px] text-danger">
                卸载失败：{uninstall.error.message}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                data-testid="market.uninstall.cancel"
                onClick={() => setConfirming(false)}
                className="mn-focus rounded-btn border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-2 hover:bg-sel"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="market.uninstall.ok"
                disabled={uninstall.isPending}
                onClick={() =>
                  uninstall.mutate(undefined, {
                    onSuccess: () => {
                      setConfirming(false);
                      pushToast({ kind: 'success', text: `已卸载「${name}」` });
                    },
                  })
                }
                className="mn-focus inline-flex items-center gap-1.5 rounded-btn bg-danger px-3.5 py-1.5 text-[13px] text-surface disabled:bg-faint"
              >
                {uninstall.isPending && <Spinner size={12} />}
                卸载
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  );
}
