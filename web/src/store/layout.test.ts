import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SIZES, useLayout, type Tab } from './layout';

const pdfTab: Tab = {
  id: 'pdf:doc_attention',
  kind: 'pdf',
  ref_id: 'doc_attention',
  title: 'Attention Is All You Need',
};
const branchTab: Tab = { id: 'branch:br_variance', kind: 'branch', ref_id: 'br_variance', title: '方差为什么是 dₖ' };

beforeEach(() => {
  localStorage.clear();
  useLayout.setState({
    sizes: [...DEFAULT_SIZES],
    collapsed: [false, false, false, false],
    rightTabs: [],
    activeTab: null,
    view: 'home',
    marketRoute: { tab: 'plugins' },
  });
});

describe('useLayout', () => {
  it('默认值符合 state.md', () => {
    const s = useLayout.getState();
    expect(s.sizes).toEqual([252, 236, 480, 560]);
    expect(s.collapsed).toEqual([false, false, false, false]);
    expect(s.view).toBe('home');
    expect(s.marketRoute).toEqual({ tab: 'plugins' });
  });

  it('setSize 受最小/最大宽度约束', () => {
    const { setSize } = useLayout.getState();
    setSize(0, 100);
    setSize(1, 999);
    setSize(2, 300);
    setSize(3, 5000);
    expect(useLayout.getState().sizes).toEqual([200, 340, 480, Math.floor(window.innerWidth * 0.55)]);
  });

  it('resetSize 恢复默认宽度', () => {
    useLayout.getState().setSize(0, 300);
    useLayout.getState().resetSize(0);
    expect(useLayout.getState().sizes[0]).toBe(252);
  });

  it('toggle 收起/展开；对话栏不可收起', () => {
    const { toggle } = useLayout.getState();
    toggle(0);
    toggle(2);
    expect(useLayout.getState().collapsed).toEqual([true, false, false, false]);
    toggle(0);
    expect(useLayout.getState().collapsed[0]).toBe(false);
  });

  it('openTab：同一 kind+ref_id 只激活不重复开；右栏收起时自动展开', () => {
    useLayout.getState().toggle(3);
    useLayout.getState().openTab(pdfTab);
    useLayout.getState().openTab(branchTab);
    useLayout.getState().openTab({ ...pdfTab, id: 'another-id' });
    const s = useLayout.getState();
    expect(s.rightTabs.map((t) => t.id)).toEqual([pdfTab.id, branchTab.id]);
    expect(s.activeTab).toBe(pdfTab.id);
    expect(s.collapsed[3]).toBe(false);
  });

  it('closeTab 关闭当前标签后激活相邻标签；activateTab 只接受已打开的标签', () => {
    const s = useLayout.getState();
    s.openTab(pdfTab);
    s.openTab(branchTab);
    useLayout.getState().closeTab(branchTab.id);
    expect(useLayout.getState().activeTab).toBe(pdfTab.id);
    useLayout.getState().activateTab('nope');
    expect(useLayout.getState().activeTab).toBe(pdfTab.id);
    useLayout.getState().closeTab(pdfTab.id);
    expect(useLayout.getState()).toMatchObject({ rightTabs: [], activeTab: null });
  });

  it('setView / setMarketRoute', () => {
    useLayout.getState().setView('market');
    useLayout.getState().setMarketRoute({ tab: 'skills', detail: { type: 'skill', id: 'pdf' } });
    expect(useLayout.getState()).toMatchObject({
      view: 'market',
      marketRoute: { tab: 'skills', detail: { type: 'skill', id: 'pdf' } },
    });
  });

  it('持久化到 localStorage 键 mn.layout.v1（只存栏宽与收起状态）', () => {
    useLayout.getState().setView('market');
    useLayout.getState().setSize(0, 300);
    useLayout.getState().toggle(1);
    const saved = JSON.parse(localStorage.getItem('mn.layout.v1') ?? '{}');
    expect(saved.state).toEqual({ sizes: [300, 236, 480, 560], collapsed: [false, true, false, false] });
  });
});
