// 规格：2-会话插件弹层-插件开关（plugins.toggle）的写操作。
// 有对话：PUT /api/conversations/{cid}/plugins {enabled_plugin_ids}，乐观更新 ['convPlugins', cid]，失败回滚并提示。
// 主页（无 cid）：暂存到主页草稿 composer['new:main'].enabled_plugin_ids，建对话后由 commitHomePlugins 一并提交。
// 生成中切换只影响下一轮：只改设置，不碰进行中的回合。
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '../../api/client';
import type { ConversationPluginList } from '../../api/endpoints';
import { queryKeys } from '../../api/queries';
import type { ID } from '../../api/types';
import { NEW_MAIN, useChat } from '../../store/chat';
import { useUI } from '../../store/ui';
import type { PluginRow } from './pluginRows';

const enc = encodeURIComponent;

/** 本对话启用列表里把 id 切到 on 后的结果（保持接口里其他插件的原值） */
export function nextEnabledIds(list: ConversationPluginList['plugins'], id: ID, on: boolean): ID[] {
  const ids = list.filter((p) => p.enabled && p.plugin_id !== id).map((p) => p.plugin_id);
  return on ? [...ids, id] : ids;
}

export function usePluginToggle(cid: ID | null | undefined, rows: PluginRow[]) {
  const qc = useQueryClient();
  return useCallback(
    async (id: ID, on: boolean) => {
      if (!cid) {
        // 主页：暂存。初值＝当前界面上开着的（默认全部可用插件）
        const cur = rows.filter((r) => r.enabled).map((r) => r.id);
        const next = on ? [...cur.filter((x) => x !== id), id] : cur.filter((x) => x !== id);
        useChat.getState().setDraft(NEW_MAIN, { enabled_plugin_ids: next });
        return;
      }
      const key = queryKeys.convPlugins(cid);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ConversationPluginList>(key);
      const base =
        prev?.plugins ?? rows.map((r) => ({ plugin_id: r.id, enabled: r.enabled, status: 'installed' as const }));
      const ids = nextEnabledIds(base, id, on);
      if (prev) {
        qc.setQueryData<ConversationPluginList>(key, {
          plugins: prev.plugins.map((p) => (p.plugin_id === id ? { ...p, enabled: on } : p)),
        });
      }
      try {
        const res = await api.put<ConversationPluginList>(`/api/conversations/${enc(cid)}/plugins`, {
          enabled_plugin_ids: ids,
        });
        qc.setQueryData(key, res);
      } catch (err) {
        if (prev) qc.setQueryData(key, prev);
        useUI.getState().pushToast({ kind: 'error', text: `插件设置没有保存：${(err as Error).message}` });
      }
    },
    [cid, rows, qc],
  );
}

/**
 * 主页建好对话后、发出首条消息前调用：主页草稿里改过插件开关时，PUT 到新对话（规格「主页无 cid 时暂存到 composer，建对话后一并提交」）。
 * 没改过就什么都不做（新对话默认启用全部已安装插件）。失败只提示，不拦发送。
 */
export async function commitHomePlugins(qc: QueryClient, cid: ID): Promise<void> {
  const ids = useChat.getState().composer[NEW_MAIN]?.enabled_plugin_ids;
  if (!ids) return;
  try {
    const res = await api.put<ConversationPluginList>(`/api/conversations/${enc(cid)}/plugins`, {
      enabled_plugin_ids: ids,
    });
    qc.setQueryData(queryKeys.convPlugins(cid), res);
  } catch (err) {
    useUI.getState().pushToast({ kind: 'error', text: `插件设置没有带到新对话：${(err as Error).message}` });
  }
}
