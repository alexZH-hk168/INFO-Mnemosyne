// 规格：1-启动-应用外壳（shell.app）
// 四栏：项目栏、文件栏、中间区（弹性）、右栏；栏间 8 px 拖拽条；外层 padding 8 px。
// 宽度以 px 存在 useLayout.sizes（state.md），收起后为 44 px 竖条。窄窗口自动收起只改运行时状态，不写 localStorage。
import { useCallback, useMemo, useRef, useState } from 'react';
import { useDocuments } from '../api/queries';
import FileColumn from '../files/FileColumn';
import { useViewportWidth } from '../lib/useViewportWidth';
import NewProjectDialog from '../project/NewProjectDialog';
import ProjectColumn from '../project/ProjectColumn';
import { InstallDialog } from '../market';
import SettingsDialog from '../settings/SettingsDialog';
import { useChat } from '../store/chat';
import { COLLAPSED_WIDTH, sizeLimits, useLayout, type PanelIndex } from '../store/layout';
import { useUI } from '../store/ui';
import '../styles/shell.css';
import CenterPane from './CenterPane';
import CollapsedRail from './CollapsedRail';
import { PanelControlContext, type PanelControl } from './panelControl';
import ResizeHandle, { CHAT_MIN } from './ResizeHandle';
import RightPane from '../preview/RightPane';
import Toasts, { ConnectionBar } from './Toasts';
import { useBootstrap } from './useBootstrap';
import { useShortcuts } from './useShortcuts';

/** 窗口宽 < 1100 px 文件栏自动收起；< 900 px 项目栏也收起 */
export const NARROW_FILES = 1100;
export const NARROW_PROJECT = 900;
const OUTER_PADDING = 8 * 2;
const GAPS = 8 * 3;

export default function FourPane() {
  const { offline } = useBootstrap();
  const vw = useViewportWidth();
  const sizes = useLayout((s) => s.sizes);
  const collapsed = useLayout((s) => s.collapsed);
  const storeToggle = useLayout((s) => s.toggle);
  const view = useLayout((s) => s.view);
  const rightEmpty = useLayout((s) => s.rightTabs.length === 0);
  const projectId = useChat((s) => s.projectId);
  const conversationId = useChat((s) => s.conversationId);
  const modal = useUI((s) => s.modal);
  const docs = useDocuments(projectId);
  /** 用户在“自动收起”状态下手动展开过的原因键 */
  const [overrides, setOverrides] = useState<ReadonlySet<string>>(() => new Set());

  const docsEmpty = !!docs.data && docs.data.groups.every((g) => g.documents.length === 0);

  // 运行时自动收起的原因；null 表示不自动收起
  const autoReason = useCallback(
    (i: PanelIndex): string | null => {
      if (i === 0 && vw < NARROW_PROJECT) return 'narrow:0';
      if (i === 1 && vw < NARROW_FILES) return 'narrow:1';
      // 规格 1-外壳-文件栏：新对话且无材料时默认收起；用户手动展开后尊重用户选择
      if (i === 1 && projectId && view === 'home' && !conversationId && docsEmpty) return `empty:${projectId}`;
      // 编排决定（原 U40，F4）：主页且右栏没有标签时运行时自动收起（与 UI-01 一致）；不写 localStorage、不改用户保存的 collapsed；
      // 一打开标签就展开，离开主页回到原来的 collapsed 状态
      if (i === 3 && view === 'home' && rightEmpty) return 'home-empty:3';
      return null;
    },
    [vw, projectId, view, conversationId, docsEmpty, rightEmpty],
  );

  const effective = useMemo(
    () =>
      ([0, 1, 2, 3] as PanelIndex[]).map((i) => {
        if (i === 2) return false;
        const r = autoReason(i);
        return collapsed[i] || (r !== null && !overrides.has(r));
      }) as PanelControl['effective'],
    [collapsed, overrides, autoReason],
  );

  const toggle = useCallback(
    (i: PanelIndex) => {
      if (i === 2) return; // 对话栏不可收起
      const r = autoReason(i);
      const edit = (fn: (s: Set<string>) => void) =>
        setOverrides((prev) => {
          const next = new Set(prev);
          fn(next);
          return next;
        });
      if (effective[i]) {
        if (collapsed[i]) storeToggle(i);
        if (r) edit((s) => s.add(r));
      } else if (r && overrides.has(r)) {
        edit((s) => s.delete(r)); // 回到自动收起，不写 localStorage
      } else {
        storeToggle(i);
      }
    },
    [autoReason, effective, collapsed, overrides, storeToggle],
  );

  useShortcuts(toggle);
  const control = useMemo<PanelControl>(() => ({ effective, toggle }), [effective, toggle]);

  // 实际宽度：右栏先让位，保证对话栏 ≥ 480；仍放不下时对话栏才继续变窄
  const avail = vw - OUTER_PADDING - GAPS;
  const w0 = effective[0] ? COLLAPSED_WIDTH : sizes[0];
  const w1 = effective[1] ? COLLAPSED_WIDTH : sizes[1];
  const rightMax = Math.min(sizeLimits(3)[1], avail - w0 - w1 - CHAT_MIN);
  const w3 = effective[3] ? COLLAPSED_WIDTH : Math.max(sizeLimits(3)[0], Math.min(sizes[3], rightMax));
  // 各拖拽条还能“变宽”的余量（按布局算，不量 DOM）：对话栏只能缩到 480；
  // 左两栏变宽时右栏会先让位到 400，所以左两栏的余量再加上右栏可让出的部分。
  const room = useRef<[number, number, number]>([0, 0, 0]);
  const centerRoom = Math.max(0, avail - w0 - w1 - w3 - CHAT_MIN);
  const rightYield = effective[3] ? 0 : Math.max(0, w3 - sizeLimits(3)[0]);
  room.current = [centerRoom + rightYield, centerRoom + rightYield, centerRoom];
  const getRoom0 = useCallback(() => room.current[0], []);
  const getRoom1 = useCallback(() => room.current[1], []);
  const getRoom2 = useCallback(() => room.current[2], []);

  const gap = <div aria-hidden="true" className="w-2 flex-none" />;
  // F6：市场页占据中间区与右栏位置，文件栏、右栏在市场页隐藏（规格 2-插件与Skill-市场页）；只是不渲染，不改 store，离开市场页即恢复四栏原状态
  const market = view === 'market';

  return (
    <PanelControlContext.Provider value={control}>
      <div
        data-testid="shell.app"
        data-collapsed={effective.map((c) => (c ? 1 : 0)).join('')}
        className="flex h-screen w-screen overflow-hidden bg-canvas p-2 text-[13.5px] leading-[1.55]"
      >
        {effective[0] ? (
          <CollapsedRail index={0} />
        ) : (
          <div className="h-full flex-none" style={{ width: w0 }}>
            <ProjectColumn />
          </div>
        )}
        {market ? null : !effective[0] && !effective[1] ? (
          <ResizeHandle index={0} width={w0} getGrowRoom={getRoom0} />
        ) : (
          gap
        )}
        {market ? null : effective[1] ? (
          <CollapsedRail index={1} />
        ) : (
          <div className="h-full flex-none" style={{ width: w1 }}>
            <FileColumn />
          </div>
        )}
        {market ? gap : !effective[1] ? <ResizeHandle index={1} width={w1} getGrowRoom={getRoom1} /> : gap}
        <div className="flex h-full min-w-0 flex-1">
          <CenterPane />
        </div>
        {market ? null : !effective[3] ? <ResizeHandle index={2} width={w3} getGrowRoom={getRoom2} /> : gap}
        {market ? null : effective[3] ? (
          <CollapsedRail index={3} />
        ) : (
          <div className="h-full flex-none" style={{ width: w3 }}>
            <RightPane />
          </div>
        )}
      </div>
      {modal?.kind === 'new-project' && <NewProjectDialog />}
      {modal?.kind === 'install' && <InstallDialog />}
      {modal?.kind === 'settings' && <SettingsDialog />}
      <Toasts />
      {offline && <ConnectionBar />}
    </PanelControlContext.Provider>
  );
}
