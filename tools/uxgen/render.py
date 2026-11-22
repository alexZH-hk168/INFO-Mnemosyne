# -*- coding: utf-8 -*-
import os, sys, shutil, collections, posixpath
sys.path.insert(0, os.path.dirname(__file__))
import specs_a, specs_b, specs_c, specs_d

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = REPO + '/docs/ux/specs'
ALL = specs_a.SPECS + specs_b.SPECS + specs_c.SPECS + specs_d.SPECS
BY = {e.id: e for e in ALL}
UI = {'UI-01': '01-home', 'UI-02': '02-card-paper', 'UI-03': '03-card-code', 'UI-04': '04-card-slides',
      'UI-05': '05-workspace-branch', 'UI-06': '06-workspace-evidence', 'UI-07': '07-market-plugins',
      'UI-08': '08-market-skills', 'UI-09': '09-plugin-detail', 'UI-10': '10-skill-detail', 'UI-11': '11-plugin-popover'}
MS = {'F0': '契约与 mock 基建', 'F1': '外壳、项目栏、文件栏', 'F2': '主页与卡片', 'F3': '对话流、输入框、证据胶囊',
      'F4': '右栏预览', 'F5': '分支对话', 'F6': '市场、插件、设置'}

# ---------- validate ----------
errs = []
ids = [e.id for e in ALL]; names = [e.name for e in ALL]
for x, c in collections.Counter(ids).items():
    if c > 1: errs.append('dup id ' + x)
for x, c in collections.Counter(names).items():
    if c > 1: errs.append('dup name ' + x)
def targets(t):
    return [] if t is None else (t if isinstance(t, list) else [t])
for e in ALL:
    if e.parent and e.parent not in BY: errs.append(f'{e.id}: parent {e.parent} missing')
    for d in e.down:
        for t in targets(d[2]):
            if t not in BY: errs.append(f'{e.id}: down target {t} missing')
    for c in e.concept:
        if c not in UI: errs.append(f'{e.id}: bad concept {c}')
    if e.milestone not in MS: errs.append(f'{e.id}: bad milestone')
    if not e.accept: errs.append(f'{e.id}: no accept')
if errs:
    print('\n'.join(errs)); sys.exit(1)

def path_of(e): return f'{OUT}/{e.folder}/{e.name}.md'
def rel(src, dst): return posixpath.relpath(path_of(dst), posixpath.dirname(path_of(src)))
def link(src, tid):
    t = BY[tid]; return f'[{t.name}]({rel(src, t)})'
def esc(s): return str(s).replace('|', '\\|').replace('\n', ' ')

incoming = collections.defaultdict(list)
for e in ALL:
    for d in e.down:
        for t in targets(d[2]):
            if t != e.id and e.id not in incoming[t]: incoming[t].append(e.id)
    if e.parent and e.id not in incoming[e.parent]: pass

def render(e):
    L = [f'# {e.name}', '']
    depth = '../../..'
    concept = '、'.join(f'[{c}]({depth}/assets/ui/{UI[c]}.png)' for c in e.concept) or '无（实现前需补概念图或实现后截图确认）'
    L += ['| 项 | 值 |', '|---|---|',
          f'| ID / data-testid | `{e.id}` |', f'| 类型 | {e.type} |', f'| 级数 | {e.level} |',
          f'| 上级规格 | {link(e, e.parent) if e.parent else "—（复用组件，见“上一级”）"} |',
          f'| 概念图 | {concept} |', f'| 建议组件 | `{e.component}` |',
          f'| 里程碑 | {e.milestone}（{MS[e.milestone]}） |', '| 规格状态 | 草案 v0.1，2026-11-22，待用户确认 |', '', e.summary, '']
    L += ['## 上一级：从哪里进来', '', '| 入口 | 触发条件 | 传入的数据 / 接口 |', '|---|---|---|']
    for a, b, c in e.up: L.append(f'| {esc(a)} | {esc(b) or "—"} | {esc(c) or "—"} |')
    inc = [i for i in incoming.get(e.id, []) if i != e.parent]
    if inc: L += ['', '其他指向本规格的规格：' + '、'.join(link(e, i) for i in inc) + '。']
    L += ['', '## 下一级：去哪里', '']
    if e.down:
        L += ['| 操作 | 结果 | 目标规格 | 调用的接口 / store action |', '|---|---|---|---|']
        for a, b, t, c in e.down:
            tl = '、'.join(link(e, x) for x in targets(t)) or '—'
            L.append(f'| {esc(a)} | {esc(b) or "—"} | {tl} | {esc(c) or "—"} |')
    else:
        L.append('无下一级（叶子节点）。')
    L += ['', '## 接口', '']
    if e.api:
        L += ['| 类型 | 名称 | 何时调用 | 字段与说明 |', '|---|---|---|---|']
        for k, n, w, f in e.api: L.append(f'| {k} | `{esc(n)}` | {esc(w)} | {esc(f)} |')
        L += ['', f'字段定义见 [REST]({depth}/contract/rest-api.md)、[SSE]({depth}/contract/sse-events.md)、[类型]({depth}/contract/types.ts)；query key 见 [state.md]({depth}/ux/state.md)。']
    else:
        L.append('不直接调用后端接口。')
    L += ['', '## 读写的前端状态', '']
    L += [f'- {s}' for s in e.store] if e.store else ['- 无全局状态，只用组件内部 state。']
    L += ['', '## 状态', '', '| 状态 | 表现 |', '|---|---|']
    for s in e.states: L.append(f'| {esc(s[0])} | {esc(s[1]) if len(s) > 1 else ""} |')
    if not e.states: L.append('| 默认 | 见概念图 |')
    if e.rules: L += ['', '## 交互细则', ''] + [f'- {r}' for r in e.rules]
    L += ['', '## 验收', ''] + [f'- [ ] {a}' for a in e.accept]
    L += ['- [ ] 所有可点元素带 `data-testid`，键盘可达，焦点可见。']
    if e.gaps: L += ['', '## 待确认 / 缺口', ''] + [f'- {g}' for g in e.gaps]
    return '\n'.join(L) + '\n'

if os.path.isdir(OUT): shutil.rmtree(OUT)
for e in ALL:
    p = path_of(e); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf-8').write(render(e))

# ---------- page map ----------
M = ['# 页面地图', '', f'全部 {len(ALL)} 份规格，按“上级规格”成树。每份规格一个文件，路径 `specs/<分组>/<名称>.md`。本文件由 `tools/uxgen` 生成，改规格后重新生成，不手改。', '',
     '类型：窗口（占据一栏或中间区的界面）、模块（窗口内的一块区域或不可见的逻辑模块）、弹窗、弹层、按钮（含可点的行与开关）。', '']
children = collections.defaultdict(list)
roots = []
for e in ALL:
    (children[e.parent].append(e) if e.parent else roots.append(e))
def mpath(e): return posixpath.relpath(path_of(e), REPO + '/docs/ux')
def walk(e, d):
    M.append('  ' * d + f'- [{e.name}]({mpath(e)}) · {e.type} · `{e.id}` · {e.milestone}')
    for c in children[e.id]: walk(c, d + 1)
M += ['## 层级树', '']
for r in roots: walk(r, 0)
M += ['', '## 按里程碑', '']
for m, desc in MS.items():
    items = [e for e in ALL if e.milestone == m]
    if not items: continue
    M += [f'### {m} {desc}（{len(items)} 份）', ''] + [f'- [{e.name}]({mpath(e)})' for e in items] + ['']
M += ['## 有缺口或无概念图的规格', '', '| 规格 | 缺口 |', '|---|---|']
for e in ALL:
    gs = list(e.gaps) + ([] if e.concept else ['无概念图'])
    if gs: M.append(f'| [{e.name}]({mpath(e)}) | {esc("；".join(dict.fromkeys(gs)))} |')
M += ['', '## 立项稿明确 v1 不做（不建规格）', '',
      '- 对话重命名、删除、搜索；对话栏头部的搜索、分享、更多图标。',
      '- 输入框语音按钮；消息编辑。',
      '- 右栏任何编辑能力（批注、改代码、运行 Notebook）。',
      '- 多用户、登录、移动端布局、深色主题。', '']
open(REPO + '/docs/ux/页面地图.md', 'w', encoding='utf-8').write('\n'.join(M))
cnt = collections.Counter(e.type for e in ALL)
print('specs', len(ALL), dict(cnt), 'roots', [r.id for r in roots])
print('per milestone', collections.Counter(e.milestone for e in ALL))
