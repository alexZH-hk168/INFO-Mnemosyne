// 规格：docs/ux/state.md「useLayout」。字段与 action 名照抄，持久化到 localStorage 键 mn.layout.v1。
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type PanelIndex = 0 | 1 | 2 | 3; // 项目栏、文件栏、对话栏、右栏
export type Sizes = [number, number, number, number];
export type Collapsed = [boolean, boolean, boolean, boolean];

export type TabKind = 'branch' | 'pdf' | 'pptx' | 'code' | 'md' | 'web' | 'message' | 'plugin';
export interface Tab {
  id: string;
  kind: TabKind;
  ref_id: string;
  title: string;
}

export type View = 'home' | 'conversation' | 'market';
export interface MarketRoute {
  tab: 'plugins' | 'skills' | 'installed';
  detail?: { type: 'plugin' | 'skill'; id: string };
}

export interface LayoutState {
  sizes: Sizes;
  collapsed: Collapsed;
  setSize: (i: PanelIndex, px: number) => void;
  resetSize: (i: PanelIndex) => void;
  toggle: (i: PanelIndex) => void;
  rightTabs: Tab[];
  activeTab: string | null;
  openTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  view: View;
  setView: (view: View) => void;
  marketRoute: MarketRoute;
  setMarketRoute: (route: MarketRoute) => void;
}

/** 默认宽度：项目栏 252、文件栏 236、对话栏弹性（记录下限 480）、右栏 560 */
export const DEFAULT_SIZES: Sizes = [252, 236, 480, 560];
/** 收起后竖条宽度 */
export const COLLAPSED_WIDTH = 44;
const CHAT: PanelIndex = 2;
const RIGHT: PanelIndex = 3;

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1440 : window.innerWidth;
}

/** 各栏宽度限制（state.md）：项目栏 200–360，文件栏 200–340，对话栏 ≥ 480，右栏 400 – 视口 55% */
export function sizeLimits(i: PanelIndex): [number, number] {
  switch (i) {
    case 0:
      return [200, 360];
    case 1:
      return [200, 340];
    case 2:
      return [480, Number.POSITIVE_INFINITY];
    case 3:
      return [400, Math.max(400, Math.floor(viewportWidth() * 0.55))];
  }
}

const clamp = (i: PanelIndex, px: number) => {
  const [min, max] = sizeLimits(i);
  return Math.min(max, Math.max(min, Math.round(px)));
};

export const useLayout = create<LayoutState>()(
  persist(
    (set, get) => ({
      sizes: [...DEFAULT_SIZES],
      collapsed: [false, false, false, false],
      setSize: (i, px) =>
        set((s) => {
          const sizes = [...s.sizes] as Sizes;
          sizes[i] = clamp(i, px);
          return { sizes };
        }),
      resetSize: (i) =>
        set((s) => {
          const sizes = [...s.sizes] as Sizes;
          sizes[i] = DEFAULT_SIZES[i];
          return { sizes };
        }),
      toggle: (i) => {
        if (i === CHAT) return; // 对话栏不可收起，恒为 false
        set((s) => {
          const collapsed = [...s.collapsed] as Collapsed;
          collapsed[i] = !collapsed[i];
          return { collapsed };
        });
      },
      rightTabs: [],
      activeTab: null,
      openTab: (tab) => {
        const s = get();
        const existing = s.rightTabs.find((t) => t.kind === tab.kind && t.ref_id === tab.ref_id);
        const collapsed = [...s.collapsed] as Collapsed;
        collapsed[RIGHT] = false; // 打开时右栏若收起则自动展开
        if (existing) {
          set({ activeTab: existing.id, collapsed });
          return;
        }
        set({ rightTabs: [...s.rightTabs, tab], activeTab: tab.id, collapsed });
      },
      closeTab: (id) =>
        set((s) => {
          const idx = s.rightTabs.findIndex((t) => t.id === id);
          if (idx < 0) return {};
          const rightTabs = s.rightTabs.filter((t) => t.id !== id);
          let activeTab = s.activeTab;
          if (activeTab === id) activeTab = (rightTabs[idx] ?? rightTabs[idx - 1])?.id ?? null;
          return { rightTabs, activeTab };
        }),
      activateTab: (id) => set((s) => (s.rightTabs.some((t) => t.id === id) ? { activeTab: id } : {})),
      view: 'home',
      setView: (view) => set({ view }),
      marketRoute: { tab: 'plugins' },
      setMarketRoute: (route) => set({ marketRoute: route }),
    }),
    {
      name: 'mn.layout.v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // 只持久化栏宽与收起状态（state.md）；右栏标签、view、marketRoute 随路由与数据恢复
      partialize: (s) => ({ sizes: s.sizes, collapsed: s.collapsed }),
    },
  ),
);
