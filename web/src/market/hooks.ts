// F6 的写操作（useMutation）与组合读取。key 与失效规则照各规格「接口」表；读取 hook 复用 api/queries.ts。
// 会话插件开关的 mutation（useSetConvPlugins）先写在这里，供 F6b 的会话插件弹层使用。
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  ConversationPluginList,
  ImportSkillBody,
  MarketList,
  OkResult,
  SkillList,
  UpdateSettingsBody,
} from '../api/endpoints';
import { queryKeys, useConvPlugins, useMarket, usePlugins, useSkills } from '../api/queries';
import type { ID, InstalledPlugin, MarketItem, MemoryItem, Settings, Skill } from '../api/types';
import { useChat } from '../store/chat';

const enc = encodeURIComponent;

/** 安装/重新自检后失效的 key（规格 3-安装-安装确认弹窗、3-插件详情-配置卡） */
function invalidatePlugin(qc: QueryClient, id: ID, cid: ID | null) {
  void qc.invalidateQueries({ queryKey: queryKeys.plugins() });
  void qc.invalidateQueries({ queryKey: queryKeys.plugin(id) });
  void qc.invalidateQueries({ queryKey: queryKeys.market('plugins') });
  if (cid) void qc.invalidateQueries({ queryKey: queryKeys.convPlugins(cid) });
}

export const installKey = (id: ID) => ['installPlugin', id] as const;

/** POST /api/plugins/{id} `{config}`：安装或改配置后重新自检 */
export function useInstallPlugin(id: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: installKey(id),
    mutationFn: (config: Record<string, string>) => api.post<InstalledPlugin>(`/api/plugins/${enc(id)}`, { config }),
    onSuccess: () => invalidatePlugin(qc, id, useChat.getState().conversationId),
  });
}

/** 安装成功且有当前对话时，把该插件追加到本对话启用列表（PUT /api/conversations/{cid}/plugins） */
export async function enableInConversation(qc: QueryClient, cid: ID, pluginId: ID): Promise<void> {
  const current = await qc.fetchQuery({
    queryKey: queryKeys.convPlugins(cid),
    queryFn: () => api.get<ConversationPluginList>(`/api/conversations/${enc(cid)}/plugins`),
    staleTime: 0,
  });
  const ids = new Set(current.plugins.filter((p) => p.enabled).map((p) => p.plugin_id));
  ids.add(pluginId);
  const next = await api.put<ConversationPluginList>(`/api/conversations/${enc(cid)}/plugins`, {
    enabled_plugin_ids: [...ids],
  });
  qc.setQueryData(queryKeys.convPlugins(cid), next);
}

/** DELETE /api/plugins/{id}；失效 ['plugins']、['plugin', id]、全部 ['convPlugins'] */
export function useUninstallPlugin(id: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<OkResult>(`/api/plugins/${enc(id)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      void qc.invalidateQueries({ queryKey: queryKeys.plugin(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.market('plugins') });
      void qc.invalidateQueries({ queryKey: ['convPlugins'] });
    },
  });
}

/** PUT /api/conversations/{cid}/plugins（F6b 会话插件弹层用） */
export function useSetConvPlugins(cid: ID | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled_plugin_ids: ID[]) =>
      api.put<ConversationPluginList>(`/api/conversations/${enc(cid ?? '')}/plugins`, { enabled_plugin_ids }),
    onSuccess: (data) => {
      if (cid) qc.setQueryData(queryKeys.convPlugins(cid), data);
    },
  });
}

/** POST /api/skills/import；失效 ['skills']、['market','skills'] */
export function useImportSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: ImportSkillBody) => api.post<Skill>('/api/skills/import', b),
    onSuccess: (skill) => {
      qc.setQueryData<SkillList>(queryKeys.skills(), (old) =>
        old ? { skills: [...old.skills.filter((s) => s.id !== skill.id), skill] } : old,
      );
      qc.setQueryData<MarketList>(queryKeys.market('skills'), (old) =>
        old ? { items: old.items.map((i) => (i.id === skill.id ? { ...i, installed: true } : i)) } : old,
      );
      void qc.invalidateQueries({ queryKey: queryKeys.skills() });
      void qc.invalidateQueries({ queryKey: queryKeys.market('skills') });
      void qc.invalidateQueries({ queryKey: queryKeys.skill(skill.id) });
    },
  });
}

/** PUT /api/skills/{id} `{enabled}`：全局启用/停用 */
export function useToggleSkill(id: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.put<Skill>(`/api/skills/${enc(id)}`, { enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.skills() });
      void qc.invalidateQueries({ queryKey: queryKeys.skill(id) });
    },
  });
}

/** PUT /api/settings；成功后写回 ['settings'] 并失效 */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: UpdateSettingsBody) => api.put<Settings>('/api/settings', b),
    onSuccess: (s) => {
      qc.setQueryData(queryKeys.settings(), s);
      void qc.invalidateQueries({ queryKey: queryKeys.settings() });
    },
    onError: () => void qc.invalidateQueries({ queryKey: queryKeys.settings() }),
  });
}

export function useUpdateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: ID; content: string }) =>
      api.put<MemoryItem>(`/api/memory/items/${enc(id)}`, { content }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['memory'] }),
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: ID) => api.del<OkResult>(`/api/memory/items/${enc(id)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['memory'] }),
  });
}

/** 某条目在当前上下文里的安装状态：插件看 ['plugins'] 与本对话 ['convPlugins']，Skill 看 ['skills'] */
export interface InstallState {
  installed: boolean;
  /** 插件已在当前对话启用（规格 2-条目卡片-安装按钮「已安装 · 本对话已启用」） */
  enabledHere: boolean;
}

export function useInstallState(item: Pick<MarketItem, 'id' | 'type' | 'installed'>): InstallState {
  const plugins = usePlugins();
  const skills = useSkills();
  const cid = useChat((s) => s.conversationId);
  const conv = useConvPlugins(item.type === 'plugin' ? cid : null);
  if (item.type === 'skill') {
    const installed = skills.data ? skills.data.skills.some((s) => s.id === item.id) : item.installed;
    return { installed, enabledHere: false };
  }
  const installed = plugins.data ? plugins.data.plugins.some((p) => p.id === item.id) : item.installed;
  const enabledHere = installed && !!cid && !!conv.data?.plugins.some((p) => p.plugin_id === item.id && p.enabled);
  return { installed, enabledHere };
}

/** 市场条目（按 id 查）；详情页与安装弹窗用 */
export function useMarketItem(type: 'plugin' | 'skill', id: ID | null | undefined): MarketItem | undefined {
  const list = useMarket(type === 'plugin' ? 'plugins' : 'skills');
  return id ? list.data?.items.find((i) => i.id === id) : undefined;
}

/** 条目在本类 registry 中的序号（决定色块颜色）；不在 registry 的自定义 Skill 返回 -1 */
export function useRegistryIndex(type: 'plugin' | 'skill', id: ID): number {
  const list = useMarket(type === 'plugin' ? 'plugins' : 'skills');
  return list.data?.items.findIndex((i) => i.id === id) ?? -1;
}
