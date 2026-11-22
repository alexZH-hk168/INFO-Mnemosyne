// 规格：3-条目卡片-Skill详情页（market.skill-detail）
// 左：SKILL.md 头部（name、description、license）与正文预览；右：安装/启用、加载方式说明、目录与附带文件、来源。
// 数据：已安装读 ['skill', id]（GET /api/skills/{id}）；未安装只有 ['market','skills'] 的条目。
// registry 是否缓存 SKILL.md 正文契约未定义（规格「待确认」）：未缓存时未安装条目只显示简介。
import { useSkill, useSkills } from '../api/queries';
import { Spinner } from '../icons/Icons';
import type { MarketRoute } from '../store/layout';
import { useUI } from '../store/ui';
import { Breadcrumbs, DetailError, DetailLoading, SidePanel } from './DetailParts';
import { displayRepo, formatStarsFull, isScriptFile, starsTooltip } from './format';
import { useMarketItem, useRegistryIndex, useToggleSkill } from './hooks';
import { BookIcon, FileIcon, SparkIcon, StarIcon } from './icons';
import InstallButton from './InstallButton';
import Logo, { CategoryTag, OfficialTag } from './Logo';
import Markdown from './Markdown';
import { headingsOf, splitFrontMatter } from './markdownParse';
import { GlobeIcon } from '../icons/Icons';
import { backToList } from './marketNav';

/** github.com/anthropics/skills/tree/main/skills/pdf → anthropics/skills · skills/pdf */
function repoLabel(url: string): string {
  const m = /github\.com\/([^/]+)\/([^/]+)(?:\/tree\/[^/]+\/(.+))?/.exec(url);
  if (!m) return displayRepo(url);
  return m[3] ? `${m[1]}/${m[2]} · ${m[3]}` : `${m[1]}/${m[2]}`;
}
const repoOf = (url: string) => /github\.com\/([^/]+\/[^/]+)/.exec(url)?.[1];

export default function SkillDetail({ id, tab }: { id: string; tab: MarketRoute['tab'] }) {
  const listTab: MarketRoute['tab'] = tab === 'installed' ? 'installed' : 'skills';
  const skills = useSkills();
  const installedSkill = skills.data?.skills.find((s) => s.id === id);
  const detail = useSkill(installedSkill ? id : null);
  const item = useMarketItem('skill', id);
  const index = useRegistryIndex('skill', id);
  const name = detail.data?.name ?? installedSkill?.name ?? item?.name ?? id;
  const loading = skills.isPending || (installedSkill && detail.isPending);
  const failed = skills.isError || detail.isError;

  if (loading) {
    return (
      <div data-testid="market.skill-detail" className="flex min-h-0 flex-1 flex-col">
        <Breadcrumbs tab={listTab} name={name} />
        <DetailLoading />
      </div>
    );
  }
  if (failed || (!installedSkill && !item)) {
    return (
      <div data-testid="market.skill-detail" className="flex min-h-0 flex-1 flex-col">
        <Breadcrumbs tab={listTab} name={name} />
        <DetailError
          message={detail.error?.message ?? skills.error?.message ?? '没有找到这个 Skill'}
          onRetry={() => {
            void skills.refetch();
            if (installedSkill) void detail.refetch();
          }}
          onBack={() => backToList(listTab)}
        />
      </div>
    );
  }

  const d = detail.data;
  const sourceUrl = item?.repo_url ?? d?.source_url ?? '';
  const repo = sourceUrl ? repoOf(sourceUrl) : undefined;
  const body = d ? splitFrontMatter(d.skill_md).body : '';
  const headings = d ? headingsOf(body) : [];
  const toc = headings
    .filter((h) => h.level === 2)
    .map((h2) => {
      const i = headings.indexOf(h2);
      const next = headings.findIndex((h, j) => j > i && h.level <= 2);
      const children = headings.slice(i + 1, next < 0 ? undefined : next).filter((h) => h.level === 3);
      return { h2, children };
    });
  const scripts = d?.files.filter(isScriptFile) ?? [];

  return (
    <div data-testid="market.skill-detail" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <Breadcrumbs tab={listTab} name={name} />
      <div className="flex gap-7 px-9 pb-5 pt-[22px]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-4">
            <Logo name={name} index={index} size="lg" />
            <div className="min-w-0">
              <h2 className="font-serif text-[24px] font-semibold text-ink">{name}</h2>
              <div className="mt-[3px] flex flex-wrap items-center gap-2.5 text-[12.5px] text-muted">
                <span>{repo ?? item?.owner ?? d?.dir_path}</span>
                {item && <OfficialTag official={item.official} />}
                {item && (
                  <span title={starsTooltip(item)} className="inline-flex items-center gap-1">
                    <StarIcon />
                    {formatStarsFull(item.stars)}（整个仓库）
                  </span>
                )}
                {item && <CategoryTag category={item.category} />}
              </div>
            </div>
          </div>
          <p data-testid="market.skill-detail.lead" className="mb-[18px] mt-4 text-[14px] leading-[1.8] text-ink-2">
            {item?.desc_zh ?? d?.description}。Skill
            不提供新工具，它是一份操作说明：助手遇到相关任务时先读这份说明，再按里面的方法去做。
          </p>

          <h3 className="mb-2 mt-[18px] flex items-baseline gap-2 text-[13px] font-semibold text-ink">
            SKILL.md 预览
            <span className="text-[11.5px] font-normal text-muted">只读</span>
          </h3>
          <div className="rounded-card border border-line bg-surface px-5 py-4">
            {d ? (
              <Markdown source={d.skill_md} testid="market.skill-detail.md" />
            ) : (
              <p data-testid="market.skill-detail.no-preview" className="text-[13px] leading-[1.75] text-muted">
                市场清单只带名称和简介，没有缓存 SKILL.md 正文。安装后可以在这里预览全文。
              </p>
            )}
          </div>
        </div>

        <aside className="flex w-[340px] flex-none flex-col gap-3.5">
          {item ? <InstallButton item={{ ...item, installed: !!installedSkill }} variant="detail" /> : null}
          {installedSkill && <EnableSwitch id={id} enabled={installedSkill.enabled} />}
          <SidePanel testid="market.skill-detail.loading-mode" icon={<SparkIcon />} title="加载方式">
            <p className="text-[12.5px] leading-[1.7] text-ink-2">
              平时只把名字和 description 告诉助手。遇到相关问题时它会自己读取全文；也可以在输入框里输入{' '}
              <b className="font-mono text-ink">/{name}</b> 强制使用。
            </p>
          </SidePanel>
          {d && toc.length > 0 && (
            <SidePanel testid="market.skill-detail.toc" icon={<BookIcon />} title="目录">
              <ul className="text-[12.5px] leading-[2] text-ink-2">
                {toc.map(({ h2, children }) => (
                  <li key={h2.id}>
                    {h2.text}
                    {children.length > 0 && (
                      <div className="pl-3.5 text-muted">{children.map((c) => c.text).join(' · ')}</div>
                    )}
                  </li>
                ))}
              </ul>
            </SidePanel>
          )}
          {d && (
            <SidePanel testid="market.skill-detail.files" icon={<FileIcon />} title="附带文件">
              <ul className="text-[12.5px]">
                {d.files.map((f) => (
                  <li
                    key={f}
                    data-testid={`market.skill-detail.file:${f}`}
                    className="flex items-center gap-2 py-0.5 font-mono text-[12px] text-ink-2"
                  >
                    {f}
                    {isScriptFile(f) && <span className="ml-auto font-sans text-[11px] text-faint">不执行</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11.5px] leading-[1.6] text-muted">
                {scripts.length > 0 ? '其他文件按需读取；包内脚本第一版不执行。' : '其他文件按需读取。'}
              </p>
            </SidePanel>
          )}
          <SidePanel testid="market.skill-detail.source" icon={<GlobeIcon size={14} />} title="来源">
            <dl className="text-[12.5px]">
              {sourceUrl && (
                <div className="flex justify-between gap-3 py-1">
                  <dt className="flex-none text-muted">仓库</dt>
                  <dd className="min-w-0 truncate">
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mn-focus text-ink-2 hover:underline"
                    >
                      {repoLabel(sourceUrl)}
                    </a>
                  </dd>
                </div>
              )}
              {(item?.license ?? d?.license) && (
                <div className="flex justify-between py-1">
                  <dt className="text-muted">许可证</dt>
                  <dd className="text-ink-2">{item?.license ?? d?.license}</dd>
                </div>
              )}
              {d && (
                <div className="flex justify-between gap-3 py-1">
                  <dt className="flex-none text-muted">本机目录</dt>
                  <dd className="min-w-0 truncate font-mono text-[11.5px] text-ink-2">{d.dir_path}</dd>
                </div>
              )}
              <div className="flex justify-between py-1">
                <dt className="text-muted">更新</dt>
                <dd className="text-ink-2">见仓库提交记录</dd>
              </div>
            </dl>
          </SidePanel>
        </aside>
      </div>
    </div>
  );
}

/** 启用开关（已安装）：全局启用/停用，PUT /api/skills/{id} `{enabled}` */
function EnableSwitch({ id, enabled }: { id: string; enabled: boolean }) {
  const toggle = useToggleSkill(id);
  const pushToast = useUI((s) => s.pushToast);
  const on = toggle.isPending ? !enabled : enabled;
  return (
    <div className="flex items-center gap-2.5 rounded-panel border border-line bg-surface px-4 py-3 text-[13px] text-ink">
      <span className="flex-1">
        启用这个 Skill
        <span className="block text-[11.5px] text-muted">停用后助手看不到它，也不能用 / 调用</span>
      </span>
      {toggle.isPending && <Spinner size={12} />}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="启用这个 Skill"
        data-testid="market.skill-detail.toggle"
        disabled={toggle.isPending}
        onClick={() =>
          toggle.mutate(!enabled, {
            onError: (e) => pushToast({ kind: 'error', text: `切换失败：${e.message}` }),
          })
        }
        className={`mn-focus relative h-[18px] w-8 flex-none rounded-pill transition-colors ${on ? 'bg-ok' : 'bg-[var(--perm-note)]'}`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-pill bg-surface shadow transition-[left] ${on ? 'left-4' : 'left-0.5'}`}
        />
      </button>
    </div>
  );
}
