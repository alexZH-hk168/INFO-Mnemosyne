// 规格：2-用户卡片-设置弹窗（settings.dialog）
// 大弹窗，左侧导航：模型、检索、记忆。模型页见 ModelSection.tsx（规格 3-设置-模型，v0.5 [BYOK]：服务商预设、测试连接、
// 演示模式说明）；检索页设联网检索默认值；记忆页见 3-设置-记忆管理。保存 = PUT /api/settings（只发当前页改动的字段），API Key 只写不读。
// 无概念图（未决 U7），实现后截图交用户确认。
import { useState, type FormEvent, type ReactNode } from 'react';
import { useSettings } from '../api/queries';
import type { Settings } from '../api/types';
import { Spinner } from '../icons/Icons';
import { useSaveSettings } from '../market/hooks';
import ModalFrame from '../market/ModalFrame';
import { useUI } from '../store/ui';
import MemorySection from './MemorySection';
import ModelSection from './ModelSection';
import Switch from './Switch';

export type Section = 'model' | 'search' | 'memory';
const NAV: { key: Section; label: string }[] = [
  { key: 'model', label: '模型' },
  { key: 'search', label: '检索' },
  { key: 'memory', label: '记忆' },
];

export default function SettingsDialog() {
  const closeModal = useUI((s) => s.closeModal);
  const modal = useUI((s) => s.modal);
  const initial = modal?.props?.section;
  const [section, setSection] = useState<Section>(initial === 'search' || initial === 'memory' ? initial : 'model');
  const settings = useSettings();

  return (
    <ModalFrame
      testid="settings.dialog"
      title="设置"
      onClose={closeModal}
      width={760}
      hideTitle
      className="flex h-[560px] flex-col"
    >
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="设置分类"
          className="flex w-[168px] flex-none flex-col gap-0.5 border-r border-line bg-panel px-2.5 py-4"
        >
          <div aria-hidden="true" className="px-2.5 pb-3 font-serif text-[17px] font-semibold text-ink">
            设置
          </div>
          {NAV.map((n) => (
            <button
              key={n.key}
              type="button"
              data-testid={`settings.dialog.nav:${n.key}`}
              aria-current={section === n.key ? 'page' : undefined}
              onClick={() => setSection(n.key)}
              className={`mn-focus rounded-btn px-2.5 py-1.5 text-left text-[13px] ${
                section === n.key ? 'bg-sel text-ink' : 'text-ink-2 hover:bg-sel'
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {settings.isPending ? (
            <div className="flex items-center gap-2 p-6 text-[13px] text-muted">
              <Spinner size={13} /> 正在读取设置…
            </div>
          ) : settings.isError ? (
            <div role="alert" data-testid="settings.dialog.load-error" className="p-6 text-[13px] text-ink-2">
              设置加载失败：{settings.error.message} ·{' '}
              <button
                type="button"
                onClick={() => void settings.refetch()}
                className="mn-focus underline underline-offset-2"
              >
                重试
              </button>
            </div>
          ) : section === 'model' ? (
            <ModelPage key="model" settings={settings.data} onClose={closeModal} />
          ) : section === 'search' ? (
            <SearchSection key="search" settings={settings.data} onClose={closeModal} />
          ) : (
            <MemorySection settings={settings.data} />
          )}
        </div>
      </div>
    </ModalFrame>
  );
}

/** 页面骨架：标题 + 内容 + 底部按钮（关闭 / 保存） */
function Page({
  testid,
  title,
  children,
  onSubmit,
  onClose,
  dirty,
  saving,
  banner,
}: {
  testid: string;
  title: string;
  children: ReactNode;
  onSubmit: () => void;
  onClose: () => void;
  dirty: boolean;
  saving: boolean;
  banner?: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty && !saving) onSubmit();
  };
  return (
    <form data-testid={testid} onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <h3 className="font-serif text-[17px] font-semibold text-ink">{title}</h3>
        {banner}
        <div className="mt-4 space-y-4">{children}</div>
      </div>
      <div className="flex flex-none justify-end gap-2 border-t border-line px-6 py-3">
        <button
          type="button"
          data-testid="settings.dialog.close"
          onClick={onClose}
          className="mn-focus rounded-btn border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-2 hover:bg-sel"
        >
          关闭
        </button>
        <button
          type="submit"
          data-testid="settings.dialog.save"
          disabled={!dirty || saving}
          className="mn-focus inline-flex min-w-[64px] items-center justify-center gap-1.5 rounded-btn bg-ink px-3.5 py-1.5 text-[13px] text-surface disabled:bg-faint"
        >
          {saving && <Spinner size={12} />}
          保存
        </button>
      </div>
    </form>
  );
}

function ModelPage({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  return (
    <ModelSection
      settings={settings}
      renderPage={({ onSubmit, dirty, saving, banner, children }) => (
        <Page
          testid="settings.dialog.model"
          title="模型"
          onSubmit={onSubmit}
          onClose={onClose}
          dirty={dirty}
          saving={saving}
          banner={banner}
        >
          {children}
        </Page>
      )}
    />
  );
}

function SearchSection({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const save = useSaveSettings();
  const pushToast = useUI((s) => s.pushToast);
  const [web, setWeb] = useState(settings.web_search_default);
  const dirty = web !== settings.web_search_default;
  return (
    <Page
      testid="settings.dialog.search"
      title="检索"
      onSubmit={() =>
        save.mutate(
          { web_search_default: web },
          { onSuccess: () => pushToast({ kind: 'success', text: '检索设置已保存' }) },
        )
      }
      onClose={onClose}
      dirty={dirty}
      saving={save.isPending}
      banner={
        save.isError ? (
          <p role="alert" data-testid="settings.dialog.error" className="mt-3 text-[12.5px] text-danger">
            保存失败：{save.error.message}
          </p>
        ) : null
      }
    >
      <div className="flex items-center gap-3 rounded-card-sm border border-line px-4 py-3">
        <span className="flex-1 text-[13px] text-ink">
          新对话默认开启联网检索
          <span className="block text-[11.5px] text-muted">每次提问时仍可在输入框里单独开关</span>
        </span>
        <Switch testid="settings.dialog.web-search" label="新对话默认开启联网检索" checked={web} onChange={setWeb} />
      </div>
    </Page>
  );
}
