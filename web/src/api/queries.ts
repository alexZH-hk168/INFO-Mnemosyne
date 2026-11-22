// TanStack Query 的 key 与读取 hook。key 与接口一一对应 docs/ux/state.md「TanStack Query keys」表。
// F0 只给签名与最简实现；轮询、分页细节由各里程碑按规格补充。
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './client';
import type {
  ConversationPage,
  ConversationPluginList,
  DocumentGroups,
  MarketList,
  MemoryItemList,
  MemorySummary,
  PluginList,
  ProjectList,
  SkillList,
} from './endpoints';
import type {
  ConversationTree,
  Document,
  Evidence,
  ID,
  MemoryItem,
  PluginDetail,
  Settings,
  SkillDetail,
  WebSnapshot,
} from './types';

const enc = encodeURIComponent;

/** `GET /api/memory/items?scope=&q=&status=active` 的查询参数 */
export interface MemoryFilters {
  scope?: MemoryItem['scope'];
  q?: string;
  status?: MemoryItem['status'];
}

export const queryKeys = {
  projects: () => ['projects'] as const,
  conversations: (pid: ID) => ['conversations', pid] as const,
  tree: (cid: ID) => ['tree', cid] as const,
  documents: (pid: ID) => ['documents', pid] as const,
  document: (did: ID) => ['document', did] as const,
  evidence: (eid: ID) => ['evidence', eid] as const,
  snapshot: (sid: ID) => ['snapshot', sid] as const,
  market: (type: 'plugins' | 'skills') => ['market', type] as const,
  plugins: () => ['plugins'] as const,
  plugin: (id: ID) => ['plugin', id] as const,
  skills: () => ['skills'] as const,
  skill: (id: ID) => ['skill', id] as const,
  convPlugins: (cid: ID) => ['convPlugins', cid] as const,
  settings: () => ['settings'] as const,
  memory: (filters: MemoryFilters) => ['memory', filters] as const,
  memorySummary: () => ['memorySummary'] as const,
};

const PAGE_SIZE = 20;
const DOCUMENTS_POLL_MS = 2000;

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: ({ signal }) => api.get<ProjectList>('/api/projects', { signal }),
  });
}

export function useConversations(pid: ID | null | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.conversations(pid ?? ''),
    enabled: !!pid,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<ConversationPage>(`/api/projects/${enc(pid ?? '')}/conversations`, {
        query: { cursor: pageParam, limit: PAGE_SIZE },
        signal,
      }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useTree(cid: ID | null | undefined) {
  return useQuery({
    queryKey: queryKeys.tree(cid ?? ''),
    enabled: !!cid,
    queryFn: ({ signal }) => api.get<ConversationTree>(`/api/conversations/${enc(cid ?? '')}/tree`, { signal }),
  });
}

/** 有 queued/parsing 的文件时每 2 s 轮询（state.md） */
export function useDocuments(pid: ID | null | undefined) {
  return useQuery({
    queryKey: queryKeys.documents(pid ?? ''),
    enabled: !!pid,
    queryFn: ({ signal }) => api.get<DocumentGroups>(`/api/projects/${enc(pid ?? '')}/documents`, { signal }),
    refetchInterval: (q) => {
      const groups = q.state.data?.groups ?? [];
      const busy = groups.some((g) =>
        g.documents.some((d) => d.parse_status === 'queued' || d.parse_status === 'parsing'),
      );
      return busy ? DOCUMENTS_POLL_MS : false;
    },
  });
}

export function useDocument(did: ID | null | undefined) {
  return useQuery({
    queryKey: queryKeys.document(did ?? ''),
    enabled: !!did,
    queryFn: ({ signal }) => api.get<Document>(`/api/documents/${enc(did ?? '')}`, { signal }),
  });
}

export function useEvidence(eid: ID | null | undefined) {
  return useQuery({
    queryKey: queryKeys.evidence(eid ?? ''),
    enabled: !!eid,
    queryFn: ({ signal }) => api.get<Evidence>(`/api/evidence/${enc(eid ?? '')}`, { signal }),
  });
}

export function useSnapshot(sid: ID | null | undefined) {
  return useQuery({
    queryKey: queryKeys.snapshot(sid ?? ''),
    enabled: !!sid,
    queryFn: ({ signal }) => api.get<WebSnapshot>(`/api/web_snapshots/${enc(sid ?? '')}`, { signal }),
  });
}

export function useMarket(type: 'plugins' | 'skills') {
  return useQuery({
    queryKey: queryKeys.market(type),
    queryFn: ({ signal }) => api.get<MarketList>(`/api/market/${type}`, { signal }),
  });
}

export function usePlugins() {
  return useQuery({
    queryKey: queryKeys.plugins(),
    queryFn: ({ signal }) => api.get<PluginList>('/api/plugins', { signal }),
  });
}

export function usePlugin(id: ID | null | undefined) {
  return useQuery({
    queryKey: queryKeys.plugin(id ?? ''),
    enabled: !!id,
    queryFn: ({ signal }) => api.get<PluginDetail>(`/api/plugins/${enc(id ?? '')}`, { signal }),
  });
}

export function useSkills() {
  return useQuery({
    queryKey: queryKeys.skills(),
    queryFn: ({ signal }) => api.get<SkillList>('/api/skills', { signal }),
  });
}

export function useSkill(id: ID | null | undefined) {
  return useQuery({
    queryKey: queryKeys.skill(id ?? ''),
    enabled: !!id,
    queryFn: ({ signal }) => api.get<SkillDetail>(`/api/skills/${enc(id ?? '')}`, { signal }),
  });
}

export function useConvPlugins(cid: ID | null | undefined) {
  return useQuery({
    queryKey: queryKeys.convPlugins(cid ?? ''),
    enabled: !!cid,
    queryFn: ({ signal }) =>
      api.get<ConversationPluginList>(`/api/conversations/${enc(cid ?? '')}/plugins`, { signal }),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => api.get<Settings>('/api/settings', { signal }),
  });
}

export function useMemory(filters: MemoryFilters = { status: 'active' }) {
  return useQuery({
    queryKey: queryKeys.memory(filters),
    queryFn: ({ signal }) => api.get<MemoryItemList>('/api/memory/items', { query: { ...filters }, signal }),
  });
}

export function useMemorySummary() {
  return useQuery({
    queryKey: queryKeys.memorySummary(),
    queryFn: ({ signal }) => api.get<MemorySummary>('/api/memory/summary', { signal }),
  });
}
