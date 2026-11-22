// 规格：1-外壳-项目栏（sidebar.panel）
// 品牌行（Mnemosyne、新建对话、收起）、“插件与 Skill”入口、项目树、用户卡片。不出现“搜索”“长期记忆”入口。
import { useEffect } from 'react';
import { useProjects } from '../api/queries';
import type { Project } from '../api/types';
import { BrandMark } from '../icons/Icons';
import CollapseButton from '../layout/CollapseButton';
import { isNetworkError } from '../lib/errors';
import { goHome } from '../lib/nav';
import { useChat } from '../store/chat';
import { useLayout } from '../store/layout';
import { useExpandedIds } from './expanded';
import MarketEntry from './MarketEntry';
import NewChatButton from './NewChatButton';
import NewProjectButton from './NewProjectButton';
import ProjectRow from './ProjectRow';
import UserCard from './UserCard';

export default function ProjectColumn() {
  const projects = useProjects();
  const projectId = useChat((s) => s.projectId);
  const { expandedIds, expand, collapse } = useExpandedIds();
  // 后端不可达时保留骨架（顶部另有“无法连接后端”提示）；其他请求失败显示“加载失败 · 重试”
  const offline = projects.isError && isNetworkError(projects.error);

  // 当前项目总是展开（启动、新建项目、切换项目后）
  useEffect(() => {
    if (projectId) expand(projectId);
  }, [projectId, expand]);

  const activate = (p: Project) => {
    const chat = useChat.getState();
    if (p.id === chat.projectId) {
      if (expandedIds.includes(p.id)) collapse(p.id);
      else expand(p.id);
      return;
    }
    chat.setProject(p.id);
    expand(p.id);
    // 切换项目不自动打开对话；当前对话属于旧项目，所以回到主页（市场页等其他视图保持）
    if (useLayout.getState().view === 'conversation') goHome();
  };

  return (
    <aside data-testid="sidebar.panel" className="mn-floating flex h-full flex-col px-2.5 pb-2.5 pt-3">
      <div className="flex flex-none items-center gap-2 px-1.5 pb-3 pt-0.5">
        <span className="-mr-1 flex">
          <BrandMark />
        </span>
        <span className="font-serif text-[19px] font-semibold tracking-[0.2px] text-ink">Mnemosyne</span>
        <span className="flex-1" />
        <NewChatButton />
        <CollapseButton index={0} />
      </div>

      <nav className="flex-none">
        <MarketEntry />
      </nav>
      <div className="mx-1.5 mt-2.5 h-px flex-none bg-line" />

      <div className="flex flex-none items-center justify-between px-2 pb-1.5 pt-3.5 text-[12px] text-muted">
        <span>项目</span>
        <NewProjectButton />
      </div>

      <div data-testid="sidebar.project-tree" className="min-h-0 flex-1 overflow-y-auto pb-2">
        {(projects.isPending || offline) && (
          <div data-testid="sidebar.project-tree.loading" aria-busy="true" className="space-y-3 px-2 py-2">
            <div className="mn-skel h-4 w-[80%]" />
            <div className="mn-skel h-4 w-[65%]" />
            <div className="mn-skel h-4 w-[72%]" />
          </div>
        )}
        {projects.isError && !offline && (
          <button
            type="button"
            data-testid="sidebar.project-tree.retry"
            onClick={() => void projects.refetch()}
            className="mn-focus px-2 py-1.5 text-[12.5px] text-muted hover:text-ink"
          >
            加载失败 · 重试
          </button>
        )}
        {projects.data?.projects.map((p) => (
          <ProjectRow
            key={p.id}
            project={p}
            current={p.id === projectId}
            expanded={expandedIds.includes(p.id)}
            onActivate={activate}
          />
        ))}
      </div>

      <UserCard />
    </aside>
  );
}
