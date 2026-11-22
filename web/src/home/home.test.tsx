// 单元测试：F2 主页与能力卡片（规格 03-主页 六份）。每份规格“状态”表的每个状态一条渲染测试。
// jsdom 里没有布局与动画：用 matchMedia 模拟“减少动效”，让弹窗关闭立即完成；位移动画在端到端测试里验。
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NEW_MAIN, useChat, emptyDraft } from '../store/chat';
import { useUI } from '../store/ui';
import { CARDS, getCard, neighborCard } from './cards';
import { fanFit, fanNeededWidth, fanPose, FAN_MID_DROP, FAN_ROTATE, FAN_SPREAD, FAN_SPREAD_MIN } from './fan';
import { Onboard } from './Onboard';

// F3：主页输入框换成正式的 Composer，它会读 settings / documents / skills / plugins，需要 QueryClient。
// 单元测试里查询默认不启用（enabled: false），只验证主页本身的行为；输入框的数据与请求在 src/chat 的测试里验。
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function mockMatchMedia(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  mockMatchMedia(true);
  useUI.setState({ modal: null });
  useChat.setState({ composer: { [NEW_MAIN]: emptyDraft() } });
});

describe('1-新建对话-主页（home.onboard）', () => {
  it('默认：标题、主页输入框（自动聚焦）、三张卡片；无记忆提示', () => {
    render(<Onboard />);
    expect(screen.getByTestId('home.onboard')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '今天要学习什么？' })).toBeInTheDocument();
    const box = screen.getByTestId('composer.box');
    expect(box).toHaveAttribute('data-variant', 'home');
    expect(within(box).getByRole('textbox')).toHaveFocus();
    expect(screen.queryByText(/记忆/)).toBeNull();
  });

  it('主页本身不发请求（规格「交互细则」）', () => {
    const fetchSpy = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchSpy);
    render(<Onboard />);
    fireEvent.click(screen.getByTestId('home.card:paper'));
    fireEvent.click(screen.getByTestId('home.card-dismiss'));
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('自适应：中间区不够宽时先收紧间距、再缩放；窗口矮于 760 时乘 0.85', () => {
    expect(fanFit(1000, 900)).toMatchObject({ spread: FAN_SPREAD, scale: 1 });
    const mid = fanFit(760, 900);
    expect(mid.spread).toBeLessThan(FAN_SPREAD);
    expect(mid.spread).toBeGreaterThanOrEqual(FAN_SPREAD_MIN);
    expect(mid.scale).toBe(1);
    expect(fanNeededWidth(mid.spread)).toBeLessThanOrEqual(760);
    // 对话栏下限 480，减去主页左右内边距 48
    const narrow = fanFit(432, 900);
    expect(narrow.spread).toBe(FAN_SPREAD_MIN);
    expect(fanNeededWidth(narrow.spread) * narrow.scale).toBeLessThanOrEqual(432 + 0.5);
    expect(fanFit(1000, 700).scale).toBeCloseTo(0.85, 5);
  });
});

describe('1-主页-能力卡片组（home.card-fan）', () => {
  it('默认：左“论文阅读”、中“代码解析”、右“课件学习”，卡面只有封面和标题', () => {
    render(<Onboard />);
    const fan = screen.getByTestId('home.card-fan');
    const cards = within(fan).getAllByRole('button');
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual([
      'home.card:paper',
      'home.card:code',
      'home.card:slides',
    ]);
    expect(cards.map((c) => c.textContent?.endsWith(getCard(c.dataset.testid!.split(':')[1] as never).title))).toEqual([
      true,
      true,
      true,
    ]);
    // 说明文字只在弹窗里出现
    expect(screen.queryByText(CARDS[0].description)).toBeNull();
  });

  it('默认位姿：左右各转 ±8°，中间一张略低且在最上层', () => {
    const [l, m, r] = [0, 1, 2].map((i) => fanPose(i, null));
    expect(l.rotate).toBe(-FAN_ROTATE);
    expect(r.rotate).toBe(FAN_ROTATE);
    expect(m.rotate).toBe(0);
    expect(m.y).toBe(FAN_MID_DROP);
    expect(m.y).toBeGreaterThan(l.y);
    expect(m.zIndex).toBeGreaterThan(l.zIndex);
  });

  it('悬停某张：该卡抬起 12 px 并转正、置顶，另两张向两侧让开 24 px', () => {
    for (const h of [0, 1, 2]) {
      for (const i of [0, 1, 2]) {
        const base = fanPose(i, null);
        const p = fanPose(i, h);
        if (i === h) {
          expect(p).toMatchObject({ x: base.x, y: base.y - 12, rotate: 0, zIndex: 3 });
        } else {
          expect(p.x - base.x).toBe(Math.sign(i - h) * 24);
          expect(p.y).toBe(base.y);
          expect(p.rotate).toBe(base.rotate);
        }
      }
    }
  });
});

describe('1-能力卡片组-单张卡片（home.card）', () => {
  it('卡片是 <button>，aria-label“了解论文阅读”等', () => {
    render(<Onboard />);
    for (const c of CARDS) {
      const el = screen.getByTestId(`home.card:${c.id}`);
      expect(el.tagName).toBe('BUTTON');
      expect(el).toHaveAttribute('aria-label', `了解${c.title}`);
    }
  });

  it('点击调用 useUI.openModal("card-intro", {card})，三张都能打开对应弹窗', () => {
    render(<Onboard />);
    for (const c of CARDS) {
      fireEvent.click(screen.getByTestId(`home.card:${c.id}`));
      expect(useUI.getState().modal).toEqual({ kind: 'card-intro', props: { card: c.id } });
      expect(screen.getByTestId('home.card-modal')).toHaveAttribute('data-card', c.id);
      fireEvent.click(screen.getByTestId('home.card-dismiss'));
      expect(useUI.getState().modal).toBeNull();
    }
  });

  it('封面：三种封面各自渲染（论文页、代码、课件计算图），循环动画元素带 mn-anim', () => {
    const { container } = render(<Onboard />);
    expect(container.querySelector('.mn-scene-paper .mn-sweep-win.mn-anim')).not.toBeNull();
    expect(container.querySelector('.mn-scene-code .mn-code-bar.mn-anim')).not.toBeNull();
    expect(container.querySelectorAll('.mn-scene-slides .mn-grad.mn-anim')).toHaveLength(4);
  });
});

describe('2-能力卡片-卡片介绍弹窗（home.card-modal）', () => {
  it.each(CARDS.map((c) => [c.title, c] as const))('%s：标题、说明、三行能力、示例出处与 UI-02～04 一致', (_t, c) => {
    act(() => useUI.getState().openModal('card-intro', { card: c.id }));
    render(<Onboard />);
    const dlg = screen.getByRole('dialog');
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(within(dlg).getByRole('heading', { level: 2 }).textContent).toBe(c.headline.join(''));
    expect(within(dlg).getByText(c.description)).toBeInTheDocument();
    for (const r of c.rows) {
      expect(within(dlg).getByText(r.title)).toBeInTheDocument();
      expect(within(dlg).getByText(r.desc)).toBeInTheDocument();
    }
    expect(within(dlg).getByText(c.source)).toBeInTheDocument();
    expect(within(dlg).getByText(c.overlay.label)).toBeInTheDocument();
  });

  it('课件学习：含“上次 · 作业 3”浮签；论文阅读：示例出处含“页面为示意排版，非原 PDF 截图”', () => {
    act(() => useUI.getState().openModal('card-intro', { card: 'slides' }));
    render(<Onboard />);
    expect(screen.getByText('上次 · 作业 3')).toBeInTheDocument();
    expect(getCard('paper').source).toContain('页面为示意排版，非原 PDF 截图');
  });

  it('←/→ 循环切换三张（openModal 替换 props.card）', async () => {
    render(<Onboard />);
    fireEvent.click(screen.getByTestId('home.card:paper'));
    const seq: string[] = [];
    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(document, { key: 'ArrowRight' });
      seq.push(useUI.getState().modal?.props?.card as string);
    }
    expect(seq).toEqual(['code', 'slides', 'paper']);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(useUI.getState().modal?.props?.card).toBe('slides');
    expect(neighborCard('paper', -1)).toBe('slides');
  });

  it('Esc / 遮罩 / 右上 × 都关闭，焦点回到原卡片', async () => {
    render(<Onboard />);
    for (const how of ['esc', 'scrim', 'x'] as const) {
      const card = screen.getByTestId('home.card:code');
      fireEvent.click(card);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      if (how === 'esc') fireEvent.keyDown(document, { key: 'Escape' });
      if (how === 'scrim') fireEvent.click(screen.getByTestId('home.card-modal-scrim'));
      if (how === 'x') fireEvent.click(screen.getByTestId('home.card-modal-close'));
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(screen.getByTestId('home.card:code')).toHaveFocus());
    }
  });

  it('切换后关闭：焦点回到打开弹窗的那张卡', async () => {
    render(<Onboard />);
    fireEvent.click(screen.getByTestId('home.card:paper'));
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('home.card:paper')).toHaveFocus());
  });

  it('焦点锁在弹窗内：打开时聚焦弹窗，Tab 从最后一个回到第一个，Shift+Tab 反向', () => {
    render(<Onboard />);
    fireEvent.click(screen.getByTestId('home.card:paper'));
    const dlg = screen.getByRole('dialog');
    expect(dlg).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByTestId('home.card-modal-close')).toHaveFocus();
    screen.getByTestId('home.card-dismiss').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByTestId('home.card-modal-close')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByTestId('home.card-dismiss')).toHaveFocus();
  });
});

describe('2-卡片介绍弹窗-试一试按钮（home.card-try）', () => {
  it('点击：关闭弹窗，主页输入框预填示例问题（不自动发送），焦点到输入框', async () => {
    render(<Onboard />);
    fireEvent.click(screen.getByTestId('home.card:code'));
    fireEvent.click(screen.getByTestId('home.card-try'));
    expect(useUI.getState().modal).toBeNull();
    const ta = within(screen.getByTestId('composer.box')).getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.value).toBe(getCard('code').sampleQuestion);
    expect(useChat.getState().composer[NEW_MAIN].text).toBe(getCard('code').sampleQuestion);
    expect(useChat.getState().streaming).toBeNull();
    await waitFor(() => expect(ta).toHaveFocus());
  });
});

describe('2-卡片介绍弹窗-知道了按钮（home.card-dismiss）', () => {
  it('默认：主按钮“知道了”；点击调用 useUI.closeModal()，焦点回到原卡片', async () => {
    render(<Onboard />);
    fireEvent.click(screen.getByTestId('home.card:slides'));
    const btn = screen.getByTestId('home.card-dismiss');
    expect(btn).toHaveTextContent('知道了');
    fireEvent.click(btn);
    expect(useUI.getState().modal).toBeNull();
    await waitFor(() => expect(screen.getByTestId('home.card:slides')).toHaveFocus());
  });
});
