// 启动与路由同步（规格 1-启动-应用外壳「上一级」「接口」）：
//   - 地址栏 → store（启动时与浏览器前进/后退时）；
//   - 决定默认项目：地址里有对话时取该对话的项目，否则取项目列表第一个（后端按最近更新排序）；列表为空时建“默认项目”；
//   - 打开 /c/:cid/b/:bid 时在右栏打开该分支标签；
//   - 后端不可达（网络错误）时返回 offline，并每 5 s 重试一次项目列表。
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '../api/client';
import type { ProjectList } from '../api/endpoints';
import { queryKeys, useProjects, useTree } from '../api/queries';
import type { Project } from '../api/types';
import { tabFor } from '../lib/documents';
import { isNetworkError } from '../lib/errors';
import { applyRoute, currentRoute } from '../lib/nav';
import { useChat } from '../store/chat';
import { useLayout } from '../store/layout';
import { useUI } from '../store/ui';

export const DEFAULT_PROJECT_NAME = '默认项目';
const OFFLINE_RETRY_MS = 5000;

export function useBootstrap(): { offline: boolean } {
  const qc = useQueryClient();
  const projects = useProjects();
  const conversationId = useChat((s) => s.conversationId);
  const activeBranchId = useChat((s) => s.activeBranchId);
  const tree = useTree(conversationId);
  const creating = useRef(false);

  // 地址栏 → store
  useEffect(() => {
    applyRoute(currentRoute());
    const onPop = () => applyRoute(currentRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // 当前对话所属项目
  useEffect(() => {
    const pid = tree.data?.conversation.project_id;
    if (pid && useChat.getState().projectId !== pid) useChat.getState().setProject(pid);
  }, [tree.data]);

  // 直接打开 /c/:cid/b/:bid：右栏打开该分支标签
  useEffect(() => {
    if (!activeBranchId || !tree.data) return;
    const b = tree.data.branches.find((x) => x.id === activeBranchId);
    if (b) useLayout.getState().openTab(tabFor('branch', b.id, b.title));
  }, [activeBranchId, tree.data]);

  // 默认项目
  useEffect(() => {
    const list = projects.data?.projects;
    if (!list) return;
    const chat = useChat.getState();
    if (chat.projectId && list.some((p) => p.id === chat.projectId)) return;
    // 地址里有对话：等对话树告诉我们它属于哪个项目
    if (conversationId && !tree.data && !tree.isError) return;
    if (list.length > 0) {
      chat.setProject(list[0].id);
      return;
    }
    if (creating.current) return;
    creating.current = true;
    api
      .post<Project>('/api/projects', { name: DEFAULT_PROJECT_NAME })
      .then((p) => {
        qc.setQueryData<ProjectList>(queryKeys.projects(), (old) => ({ projects: [p, ...(old?.projects ?? [])] }));
        useChat.getState().setProject(p.id);
        void qc.invalidateQueries({ queryKey: queryKeys.projects() });
      })
      .catch((e: unknown) => {
        useUI.getState().pushToast({ kind: 'error', text: `创建默认项目失败：${(e as Error).message}` });
      })
      .finally(() => {
        creating.current = false;
      });
  }, [projects.data, conversationId, tree.data, tree.isError, qc]);

  const offline = projects.isError && isNetworkError(projects.error);
  const { refetch } = projects;
  useEffect(() => {
    if (!offline) return;
    const t = window.setInterval(() => void refetch(), OFFLINE_RETRY_MS);
    return () => window.clearInterval(t);
  }, [offline, refetch]);

  return { offline };
}
