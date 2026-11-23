// 规格：1-外壳-右栏（right.panel）
// 顶部标签条＋当前标签内容。内容可以是分支对话（F5）或各类只读预览；当前标签由证据胶囊打开时顶部显示证据栏。不提供任何编辑能力。
// 无标签时显示空态：“点回答里的证据，或在文件栏选一个文件预览”。
import '../styles/preview.css';
import type { ReactNode } from 'react';
import BranchPanel from '../branch/BranchPanel';
import { useLayout, type Tab } from '../store/layout';
import { tabForEvidence } from '../store/evidence';
import CodeViewer from './CodeViewer';
import EvidenceBar from './EvidenceBar';
import MessageViewer from './MessageViewer';
import PdfViewer from './PdfViewer';
import PluginResultCard from './PluginResultCard';
import PreviewTabs from './PreviewTabs';
import SlideViewer from './SlideViewer';
import { useSelectedEvidence } from './useEvidenceContext';
import WebSnapshotViewer from './WebSnapshotViewer';

export const EMPTY_TEXT = '点回答里的证据，或在文件栏选一个文件预览';

function Content({ tab }: { tab: Tab }): ReactNode {
  switch (tab.kind) {
    case 'pdf':
      return <PdfViewer tab={tab} />;
    case 'pptx':
      return <SlideViewer tab={tab} />;
    case 'code':
    case 'md':
      return <CodeViewer key={tab.id} tab={tab} />;
    case 'web':
      return <WebSnapshotViewer key={tab.id} tab={tab} />;
    case 'message':
      return <MessageViewer key={tab.id} tab={tab} />;
    case 'plugin':
      return <PluginResultCard key={tab.id} tab={tab} />;
    case 'branch':
      // F5：2-开分支追问-分支面板
      return <BranchPanel key={tab.id} tab={tab} />;
  }
}

export default function RightPane() {
  const tabs = useLayout((s) => s.rightTabs);
  const activeId = useLayout((s) => s.activeTab);
  const tab = tabs.find((t) => t.id === activeId) ?? null;
  const { evidence } = useSelectedEvidence();
  const showBar = !!tab && !!evidence && tab.kind !== 'branch' && tabForEvidence(evidence).id === tab.id;

  return (
    <aside
      data-testid="right.panel"
      data-kind={tab?.kind ?? 'empty'}
      aria-label="右栏"
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-panel border border-line bg-surface"
    >
      <PreviewTabs />
      {tab ? (
        <>
          {showBar && evidence && <EvidenceBar evidence={evidence} />}
          <div className="min-h-0 flex-1">
            <Content tab={tab} />
          </div>
        </>
      ) : (
        <div
          data-testid="right.panel.empty"
          className="flex flex-1 items-center justify-center px-8 text-center text-[13px] leading-[1.7] text-faint"
        >
          {EMPTY_TEXT}
        </div>
      )}
    </aside>
  );
}
