import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpFromLine, Box, Check, ChevronDown, ChevronRight, CircleHelp, Expand,
  Gauge, GitBranch, Layers3, Link2, LoaderCircle, Maximize, Minimize, MousePointer2, Network, Pause, Play, RotateCcw, Scan, Search, Server, SlidersHorizontal, X } from 'lucide-react';
import ConfigPanel from './components/ConfigPanel';
import Inspector from './components/Inspector';
import { NetworkCanvas, type CanvasHandle } from './components/NetworkCanvas';
import { DEFAULT_SPEC } from './model/defaults';
import { calculate, findNode, nodeLabel, SpecError } from './model/engine';
import { formatBandwidth, formatCount } from './model/format';
import { parseProject, serializeProject } from './model/project';
import { projectFromQuery, projectToQuery } from './model/url';
import { DEFAULT_VIEW, EMPTY_FILTER, type BenchmarkResult, type CapacitySummary, type Diagnostic, type Filter,
  type FrameStats, type LayoutMode, type LayoutResult, type PathSet, type SavedProject, type TopologyBuffers, type TopologySpec, type ViewConfig } from './model/types';
import { TopologyClient } from './workers/client';
import { groupColor, SHARED_COLOR, TIER_COLORS, usesGroupColors, usesPodColors } from './render/colors';

interface Result {
  spec: TopologySpec; summary: CapacitySummary; graph: TopologyBuffers | null;
  layout: LayoutResult | null; elapsedMs: number;
}
const STORAGE_KEY = 'closlab.project.v1';
const LAYOUT_LABELS: Record<LayoutMode, string> = { layered: '3D 分层', planes: '平面展开', flat: '2D 分层', radial: '径向布局' };
function initialProject(): SavedProject & { urlError?: string } {
  const defaults: SavedProject = { format: 'closlab', version: 1, spec: structuredClone(DEFAULT_SPEC), view: { ...DEFAULT_VIEW } };
  try {
    const shared = projectFromQuery(window.location.search);
    if (shared) return shared;
  } catch (error) {
    return { ...defaults, urlError: '分享链接参数无效，已载入默认配置：' + (error instanceof Error ? error.message : String(error)) };
  }
  try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) return parseProject(saved); } catch { /* Recover safely from unavailable storage or incompatible projects. */ }
  return defaults;
}
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function App() {
  const [initial] = useState(initialProject);
  const [draft, setDraft] = useState<TopologySpec>(initial.spec);
  const [applied, setApplied] = useState<TopologySpec>(initial.spec);
  const [view, setView] = useState<ViewConfig>(initial.view);
  const [result, setResult] = useState<Result | null>(null);
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [busy, setBusy] = useState(true), [layoutBusy, setLayoutBusy] = useState(false);
  const [message, setMessage] = useState(''), [renderError, setRenderError] = useState('');
  const [urlError, setUrlError] = useState(initial.urlError ?? ''), [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<number | null>(null), [path, setPath] = useState<number[]>([]);
  const [allPaths, setAllPaths] = useState<PathSet | null>(null), [pathBusy, setPathBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>({ ...EMPTY_FILTER });
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'topology' | 'capacity'>('topology');
  const [focused, setFocused] = useState(false), [rotating, setRotating] = useState(false);
  const [help, setHelp] = useState(false), [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null);
  const [stats, setStats] = useState<FrameStats>({ fps: 0, visibleNodes: 0, visibleEdges: 0, drawCalls: 0, submittedSegments: 0 });
  const canvas = useRef<CanvasHandle>(null), client = useRef<TopologyClient | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const pathRequest = useRef(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const errors = useMemo((): Diagnostic[] => {
    try { calculate(draft); return []; }
    catch (error) { return error instanceof SpecError ? error.diagnostics : [{ field: 'spec', message: String(error) }]; }
  }, [draft]);

  useEffect(() => {
    const worker = new TopologyClient(); client.current = worker;
    let cancelled = false;
    setBusy(true); setResult(null); setLayout(null); setMessage(''); setRenderError('');
    setSelected(null); setPath([]); setFilter({ ...EMPTY_FILTER }); setRotating(false); setBenchmark(null);
    setAllPaths(null); setPathBusy(false);
    pathRequest.current++;
    worker.request<Result>('build', { spec: applied, layout: viewRef.current.layout }).then(next => {
      if (cancelled) return;
      setResult(next); setLayout(next.layout); setBusy(false);
    }).catch(error => { if (!cancelled) { setMessage(error.message); setBusy(false); } });
    return () => { cancelled = true; worker.dispose(); if (client.current === worker) client.current = null; };
  }, [applied]);
  useEffect(() => {
    if (!result?.graph || !client.current) return;
    let cancelled = false;
    setLayoutBusy(true); setRotating(false);
    client.current.request<LayoutResult>('layout', { mode: view.layout }).then(next => {
      if (!cancelled) { setLayout(next); setLayoutBusy(false); }
    }).catch(error => { if (!cancelled) { setMessage(error.message); setLayoutBusy(false); } });
    return () => { cancelled = true; };
  }, [view.layout, result?.graph]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, serializeProject(applied, view)); } catch { /* Local files remain available when browser storage is disabled. */ }
    if (!urlError) {
      const url = new URL(window.location.href); url.search = projectToQuery(applied, view);
      window.history.replaceState(window.history.state, '', url);
    }
    setCopied(false);
  }, [applied, view, urlError]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (help) dialog.current?.showModal(); else dialog.current?.close();
  }, [help]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setFocused(false); setSelected(null); setPath([]); setAllPaths(null); setPathBusy(false); pathRequest.current++; }
    };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const updateView = (patch: Partial<ViewConfig>) => setView(v => ({ ...v, ...patch }));
  const clearPaths = () => { setPath([]); setAllPaths(null); setPathBusy(false); pathRequest.current++; };
  const selectNode = (id: number | null, focus = false) => {
    setSelected(id); clearPaths();
    if (focus && id !== null) { setFilter({ ...EMPTY_FILTER }); canvas.current?.focus(id); }
  };
  const search = () => {
    if (!result?.graph) return;
    const id = findNode(result.graph, query);
    if (id === null) { setMessage('未找到节点。使用 E-0、T0-0 或节点数字编号。'); return; }
    setMessage(''); selectNode(id, true);
  };
  const showPath = async (source: string, target: string, all = false) => {
    if (!result?.graph || !client.current) return;
    clearPaths();
    const a = findNode(result.graph, source), b = findNode(result.graph, target);
    if (a === null || b === null) { setMessage('路径端点不存在，请检查源节点与目的节点编号。'); return; }
    const request = ++pathRequest.current;
    setPathBusy(true); setMessage('');
    try {
      if (all) {
        const paths = await client.current.request<PathSet>('allPaths', { source: a, target: b });
        if (request !== pathRequest.current) return;
        setAllPaths(paths.count > 0n ? paths : null);
        setMessage(paths.count > 0n ? '' : '两个节点之间没有可用路径。');
      } else {
        const nodes = await client.current.request<number[]>('path', { source: a, target: b });
        if (request !== pathRequest.current) return;
        setPath(nodes); setMessage(nodes.length ? '' : '两个节点之间没有可用路径。');
      }
      setSelected(null); setFilter({ ...EMPTY_FILTER });
    } catch (error) {
      if (request === pathRequest.current) setMessage(error instanceof Error ? error.message : '路径计算失败');
    } finally {
      if (request === pathRequest.current) setPathBusy(false);
    }
  };
  const importProject = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 65536) throw new Error('配置文件不能超过 64 KB');
      const project = parseProject(await file.text()); calculate(project.spec);
      setDraft(project.spec); setApplied(structuredClone(project.spec)); setView(project.view);
      setUrlError('');
      setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : '导入失败'); }
    if (fileInput.current) fileInput.current.value = '';
  };
  const runBenchmark = async () => {
    if (!canvas.current) return;
    setBenchmarkBusy(true); setBenchmark(null); setMessage('');
    setSelected(null); clearPaths();
    try { setBenchmark(await canvas.current.benchmark()); }
    catch (error) { setMessage(error instanceof Error ? error.message : '性能测试失败'); }
    finally { setBenchmarkBusy(false); }
  };
  const copyShareLink = async () => {
    const url = new URL(window.location.href); url.search = projectToQuery(applied, view);
    try { await navigator.clipboard.writeText(url.href); setCopied(true); }
    catch { setMessage('无法自动复制，请从地址栏复制当前网络链接。'); }
  };
  const summary = result?.summary;
  const currentSpec = result?.spec ?? applied;
  const hasFilter = Object.values(filter).some(v => v !== null);
  const groupedColors = result?.graph ? usesGroupColors(result.graph, view.colorBy) : view.colorBy === 'plane' && currentSpec.planes > 1;
  const colorGroupCount = result?.graph?.colorGroupCount ?? currentSpec.planes;
  const naturalGroups = result?.graph?.colorGroupKind === 'connection';
  const podColors = result?.graph ? usesPodColors(result.graph) : false;
  return <div className="app">
    <header className="topbar">
      <a href="./" className="brand" aria-label="ClosLab 首页"><img src="/favicon.svg" alt="" /><strong>clos<span>lab</span></strong></a>
      <div className="brand-divider" /><span className="app-subtitle">NETWORK DESIGN STUDIO</span>
      <nav className="header-actions">
        <span className="local-badge"><span className="status-dot" />本地工作空间</span>
        <button className="quiet-button" aria-label="模型说明" onClick={() => setHelp(true)}><CircleHelp size={15} /><span>模型说明</span></button>
        <button className="quiet-button" aria-label="导入" onClick={() => fileInput.current?.click()}><ArrowUpFromLine size={15} /><span>导入</span></button>
        <button className="quiet-button" aria-label="复制分享链接" title="复制当前已生成网络的分享链接" onClick={() => void copyShareLink()}>
          {copied ? <Check size={15} /> : <Link2 size={15} />}<span>{copied ? '已复制' : '分享'}</span></button>
        <button className="secondary-button export-button" onClick={() => download(serializeProject(applied, view), 'closlab-network.json')}><ArrowDownToLine size={14} /><span>导出配置</span></button>
        <input ref={fileInput} aria-label="导入配置文件" type="file" accept=".json,application/json" hidden onChange={e => void importProject(e.target.files?.[0])} />
      </nav>
    </header>
    <div className="workspace-heading">
      <div><div className="breadcrumb">工作空间<ChevronRight size={12} />网络设计</div>
        <h1>Fabric 工作台 <span>PROTOTYPE</span></h1></div>
      <p>从端口到网络，探索每一种连接。</p>
    </div>
    <main className="workbench-content">
      <ConfigPanel spec={draft} setSpec={setDraft} errors={errors} busy={busy} dirty={dirty}
        onApply={() => { if (!errors.length) { setUrlError(''); setApplied(structuredClone(draft)); setTab('topology'); } }}
        onReset={() => setDraft(structuredClone(DEFAULT_SPEC))} />
      <section className="results-section" aria-labelledby="results-heading">
        <div className="results-heading"><div><span className="section-step">02</span><h2 id="results-heading">计算结果</h2><p>容量统计与网络可视化</p></div>
          <span className={'results-state' + (dirty ? ' is-pending' : '')} role="status">
            <span className={'status-dot' + (dirty ? ' pending' : '')} />{busy ? '正在生成网络…' : dirty ? '参数待应用 · 当前显示上次生成结果' : '已与输入同步'}</span>
        </div>
        <section className="metrics" aria-label="网络统计">
          <div className="metric"><div><Server size={15} /><span>终端数量</span></div><strong data-testid="endpoint-count">{summary ? formatCount(summary.endpoints) : '—'}<small>ENDPOINTS</small></strong>
            <p>{summary ? '最大容量 ' + formatCount(summary.maxEndpoints) : '等待计算网络容量'}</p></div>
          <div className="metric"><div><Layers3 size={15} /><span>交换机数量</span></div><strong data-testid="switch-count">{summary ? formatCount(summary.switchCount) : '—'}<small>SWITCHES</small></strong>
            <p>{currentSpec.tiers.length} 个交换层 · {Math.max(1, colorGroupCount)} 个{naturalGroups ? '自动' : ''}平面</p></div>
          <div className="metric"><div><GitBranch size={15} /><span>物理连接数量</span></div><strong data-testid="link-count">{summary ? formatCount(summary.totalLinks) : '—'}<small>LINKS</small></strong>
            <p>包含终端接入与层间连接</p></div>
          <div className="metric bandwidth-metric"><div><Activity size={15} /><span>终端总注入带宽</span></div><strong data-testid="bandwidth">{summary ? formatBandwidth(summary.injectionMbps) : '—'}</strong>
            <p>单向带宽 · 每终端 {summary ? formatBandwidth(summary.endpointMbps) : '—'}</p></div>
        </section>
        <div className="workbench">
          <section className="workspace-main">
            <div className="workspace-tabs"><div>
              <button className={tab === 'topology' ? 'active' : ''} onClick={() => setTab('topology')}><Network size={14} />拓扑视图</button>
              <button className={tab === 'capacity' ? 'active' : ''} onClick={() => setTab('capacity')}><SlidersHorizontal size={14} />容量明细</button>
            </div><span className="view-caption">{busy ? '构建中' : dirty ? '有未应用的修改' : 'FOLDED CLOS'}</span></div>
            <div className={'canvas-shell' + (focused ? ' is-focused' : '')} style={{ display: tab === 'topology' ? undefined : 'none' }}>
              <div className="canvas-toolbar">
                <div className="layout-select"><Box size={14} /><select aria-label="拓扑布局" value={view.layout} onChange={e => updateView({ layout: e.target.value as LayoutMode })}>
                  {Object.entries(LAYOUT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select><ChevronDown size={12} /></div>
                <div className="toolbar-divider" />
                <div className="segmented line-select"><button className={view.lines === 'straight' ? 'active' : ''} onClick={() => updateView({ lines: 'straight' })}>直线</button>
                  <button className={view.lines === 'elbow' ? 'active' : ''} onClick={() => updateView({ lines: 'elbow' })}>折线</button></div>
                <div className="toolbar-spacer" />
                <form className="node-search" onSubmit={e => { e.preventDefault(); search(); }}><Search size={13} />
                  <input aria-label="搜索节点" value={query} onChange={e => setQuery(e.target.value)} placeholder="查找节点 ID" />
                  <kbd>↵</kbd></form>
                <button className="reset-view-button" aria-label="Reset view" title="恢复初始视角" onClick={() => canvas.current?.reset()}>
                  <RotateCcw size={13} /><span>Reset view</span></button>
                <button className="icon-button" title={focused ? '退出专注模式' : '专注模式'} aria-label={focused ? '退出专注模式' : '专注模式'} onClick={() => setFocused(v => !v)}>
                  {focused ? <Minimize size={15} /> : <Expand size={15} />}</button>
              </div>
              <div className="canvas-stage">
                <NetworkCanvas ref={canvas} graph={result?.graph ?? null} layout={layout} view={view} filter={filter}
                  selected={selected} path={path} allPaths={allPaths} onPick={id => selectNode(id)} onStats={setStats} onError={setRenderError} />
                <div className="canvas-top-label"><span className="status-dot" /><span>{hasFilter || !view.showEndpoints ? '筛选视图' : '全量拓扑'}</span>
                  <span className="canvas-label-divider" />{currentSpec.tiers.length}-TIER · {Math.max(1, colorGroupCount)} PLANE{colorGroupCount > 1 ? 'S' : ''}{naturalGroups ? ' · 自动识别' : ''}
                  {(result?.graph?.edgeCount ?? 0) > 100000 && <span>· 深度遮挡</span>}</div>
                {view.layout === 'flat' && <div className="pan-hint">滚轮缩放 · 右键拖动平移</div>}
                <div className="canvas-legend">{!groupedColors
                  ? ['终端', ...currentSpec.tiers.map((_, i) => 'T' + i)].map((label, i) =>
                    <span key={label}><i style={{ background: TIER_COLORS[i] }} />{label}</span>)
                  : <>{(currentSpec.planes > 1 || currentSpec.tiers.length > 2) && <span><i style={{ background: SHARED_COLOR }} />共享</span>}
                    {Array.from({ length: Math.min(colorGroupCount, 8) }, (_, i) =>
                      <span key={i}><i style={{ background: groupColor(i) }} />P{i}</span>)}
                    <span>{naturalGroups ? `${colorGroupCount} 个自动平面` : `共 ${colorGroupCount} 平面`}</span>
                    {podColors && <span>Fabric 按 Pod · Spine / 连线按平面</span>}</>}</div>
                <div className="canvas-settings">
                  <div className="color-mode" data-testid="color-mode">{podColors ? 'Pod / 平面颜色 · 自动' : groupedColors ? '平面颜色 · 自动' : '层级颜色 · 自动'}</div>
                  <label>显示终端<input aria-label="显示终端" type="checkbox" checked={view.showEndpoints}
                    onChange={e => { updateView({ showEndpoints: e.target.checked }); selectNode(null); }} /></label>
                  <label className="opacity-control">线条强度<input aria-label="线条强度" type="range" min="0.01" max="0.8" step="0.01"
                    value={view.opacity} onChange={e => updateView({ opacity: Number(e.target.value) })} /></label>
                </div>
                <div className="view-controls">
                  <button className="icon-button" aria-label="复位视角" title="复位视角" onClick={() => canvas.current?.reset()}><Maximize size={16} /></button>
                  <button className="icon-button" aria-label="查看全图" title="查看全图" onClick={() => canvas.current?.fit()}><Scan size={16} /></button>
                  <button className={'icon-button' + (rotating ? ' active' : '')} aria-label={rotating ? '停止旋转' : '自动旋转'} title="自动旋转"
                    disabled={view.layout === 'flat' || view.layout === 'radial'} onClick={() => setRotating(canvas.current?.toggleRotate() ?? false)}>
                    {rotating ? <Pause size={15} /> : <Play size={15} />}</button>
                  <button className={'icon-button' + (benchmarkBusy ? ' active' : '')} aria-label="运行30秒性能测试" title="运行 30 秒全量性能测试"
                    disabled={benchmarkBusy || !result?.graph || busy || layoutBusy} onClick={() => void runBenchmark()}>
                    {benchmarkBusy ? <LoaderCircle className="spin" size={15} /> : <Gauge size={16} />}</button>
                </div>
                <div className="orientation"><span>Y</span><i /><b>X</b><em>Z</em></div>
                {selected !== null && result?.graph && <div className="selection-chip"><MousePointer2 size={12} />{nodeLabel(result.graph, selected)}
                  <span>· {result.graph.adjacencyOffsets[selected + 1] - result.graph.adjacencyOffsets[selected]} 条直连链路</span>
                  <button aria-label="清除选择" onClick={() => selectNode(null)}><X size={12} /></button></div>}
                {(path.length > 0 || allPaths) && <div className="selection-chip"><GitBranch size={12} />
                  {allPaths ? `全部最短路径 · ${formatCount(allPaths.count)} 条 · 每条 ${allPaths.distance} 跳` : `已显示路径 · ${path.length - 1} 条链路`}
                  <button aria-label="清除路径" onClick={clearPaths}><X size={12} /></button></div>}
                {(busy || layoutBusy) && <div className="canvas-progress"><LoaderCircle className="spin" size={16} />{busy ? '正在构建网络' : '正在计算布局'}<small>保持每一个节点与每一条连接</small></div>}
                {!busy && summary && !summary.canRender && <div className="canvas-empty"><Layers3 size={32} /><h2>容量已计算，规模超出渲染预算</h2>
                  <p>{formatCount(summary.totalNodes)} 个节点 · {formatCount(summary.totalLinks)} 条链路</p><span>切换到目标规划，减少终端数量后生成全量网络。</span></div>}
                {renderError && <div className="canvas-empty error-surface"><h2>画布暂不可用</h2><p>{renderError}</p><span>容量统计仍可使用。</span></div>}
                {benchmarkBusy && <div className="benchmark-running"><span className="status-dot" />正在连续旋转并测量 30 秒…</div>}
                {benchmark && <div className="benchmark-result" data-testid="benchmark-result">
                  <div><strong>全量渲染测试</strong><button className="icon-button" aria-label="关闭性能结果" onClick={() => setBenchmark(null)}><X size={12} /></button></div>
                  <p><b>{benchmark.medianFps.toFixed(1)}</b> 中位 FPS <span>P95 {benchmark.p95FrameMs.toFixed(1)} ms</span></p>
                  <dl><dt>实际节点</dt><dd data-testid="benchmark-nodes">{formatCount(benchmark.nodes)}</dd>
                    <dt>实际链路</dt><dd data-testid="benchmark-links">{formatCount(benchmark.links)}</dd>
                    <dt>提交线段</dt><dd data-testid="benchmark-segments">{formatCount(benchmark.submittedSegments)}</dd>
                    <dt>画布 / DPR</dt><dd>{benchmark.width} × {benchmark.height} / {benchmark.dpr}</dd></dl>
                  <button className="text-button" onClick={() => download(JSON.stringify({ ...benchmark, userAgent: navigator.userAgent, spec: applied, view, generatedAt: new Date().toISOString() }, null, 2), 'closlab-benchmark.json')}>下载性能报告 <ArrowDownToLine size={12} /></button>
                </div>}
              </div>
              <div className="canvas-status" data-testid="render-status" data-nodes={stats.visibleNodes} data-links={stats.visibleEdges}
                data-segments={stats.submittedSegments} data-draw-calls={stats.drawCalls}
                data-ready={!busy && !layoutBusy && !!result?.graph && stats.visibleNodes > 0}>
                <div><span className="status-dot" /><span>{formatCount(stats.visibleNodes)} 节点</span><i>·</i><span>{formatCount(stats.visibleEdges)} 链路</span>
                  {hasFilter && <button className="text-button" onClick={() => setFilter({ ...EMPTY_FILTER })}>清除筛选</button>}</div>
                <div><span>{stats.fps > 0 ? stats.fps + ' FPS' : '按需渲染'}</span><i>·</i><span>{result ? result.elapsedMs.toFixed(0) + ' ms 构建' : '—'}</span></div>
              </div>
            </div>
            {tab === 'capacity' && summary && <div className="capacity-view">
              <div className="capacity-title"><span className="eyebrow">CAPACITY BREAKDOWN</span><h2>每一层，都有据可查。</h2><p>当前已生成配置的设备数量、端口分配与单向容量。</p></div>
              <div className="table-scroll"><table><thead><tr><th>层级</th><th>交换机</th><th>有效端口 / 台</th><th>下行 / 上行</th><th>预留 / 未分配</th><th>芯片带宽 / 台</th></tr></thead>
                <tbody>{currentSpec.tiers.map((p, i) => <tr key={i}><td><i className="table-dot" style={{ background: TIER_COLORS[i + 1] }} />T{i}</td>
                  <td>{formatCount(summary.switches[i])}</td><td>{p.ports * p.breakout}</td><td>{p.down} / {p.up}</td><td>{p.reserved} / {p.ports * p.breakout - p.down - p.up - p.reserved}</td><td>{p.chipTbps} Tbps</td></tr>)}</tbody></table></div>
              <h3>层间连接</h3><div className="table-scroll"><table><thead><tr><th>连接边界</th><th>物理连接</th><th>单向链路容量之和</th><th>配置下行 : 上行</th></tr></thead>
                <tbody>{summary.links.map((count, i) => <tr key={i}><td>{i === 0 ? '终端 → T0' : 'T' + (i - 1) + ' → T' + i}</td>
                  <td>{formatCount(count)}</td><td>{formatBandwidth(summary.boundaryMbps[i])}</td><td>{i === 0 ? '—' : (currentSpec.tiers[i - 1].down / currentSpec.tiers[i - 1].up).toFixed(2) + ' : 1'}</td></tr>)}</tbody></table></div>
              <div className="capacity-note"><CircleHelp size={16} /><p>层间容量是该边界全部单向链路容量之和。总注入带宽、层间容量与二分带宽采用不同口径；本工具不推断任意工作负载的吞吐。目标规划保留启用组的全部上行路径，末组允许未满配。</p></div>
            </div>}
          </section>
          <Inspector spec={currentSpec} summary={summary ?? null} graph={result?.graph ?? null} colorBy={view.colorBy} selected={selected} onSelect={selectNode}
            filter={filter} setFilter={setFilter} path={path} allPaths={allPaths} pathBusy={pathBusy}
            onPath={(a, b, all) => void showPath(a, b, all)} onClearPath={clearPaths} />
        </div>
      </section>
    </main>
    <footer className="app-footer"><span><Check size={11} />参数驱动 · 本地计算 · 全量连接</span><span>ClosLab <b>v0.1</b><span className="footer-separator">/</span> BUILD YOUR FABRIC</span></footer>
    {(message || urlError) && <div className="toast" role="alert"><CircleHelp size={16} /><span>{message || urlError}</span><button aria-label="关闭提示" onClick={() => { setMessage(''); setUrlError(''); }}><X size={14} /></button></div>}
    <dialog ref={dialog} className="help-dialog" onClose={() => setHelp(false)}>
      <div className="dialog-heading"><div><span className="eyebrow">THE MODEL</span><h2>理解你的 Clos 网络</h2></div><button className="icon-button" aria-label="关闭模型说明" onClick={() => setHelp(false)}><X size={18} /></button></div>
      <div className="dialog-content">
        <h3>规则化、可验证的连接</h3><p>每层配置下行 d 与上行 u。生成器以混合进制递归分组，每个下层交换机连接到组内不同的上层交换机，所有上行路径保留。Tier 只计算交换机层数。</p>
        <div className="formula">N<sub>max</sub> = d₀ × d₁ × … × d<sub>t−1</sub></div>
        <p>目标规划从低编号接入组开始填充；末组可留空槽位。每一层的分组数向上取整，路径选择数由下层上行端口的乘积确定。此策略给出固定布线规则下的可行配置，不做全局最少设备优化。</p>
        <h3>两种分平面边界</h3><p><b>终端接入：</b>每个平面复制一份完整交换 Fabric，终端共享且分别连接各平面。单终端总带宽等于单链路速率乘以平面数量。</p>
        <p><b>交换层上方：</b>按边界上行选择维度均分为独立平面，要求上行端口数能被平面数整除。下层设备共享，上层连接不会跨平面；端口配置不变时，仅改变分组不会增加设备。</p>
        <h3>硬件与带宽</h3><p>有效端口数 = 物理端口数 × Breakout。修改芯片带宽、物理端口数或 Breakout 会联动逻辑端口速率；逻辑速率也可手动设置。芯片带宽采用所有单向端口容量之和。首版同一交换机所有已用逻辑端口速率相同，相邻层速率必须一致。</p>
        <p>Breakout 后每条独立点到点连接计一条链路，不进一步推算光模块、光纤芯数或扇出线缆组件数量。</p>
        <h3>全量可视化</h3><p>支持 25 万总节点、500 万条链路以内的全量展开。所有终端和链路都提交到 GPU；远处重叠不会改变数量。仅用户主动筛选会减少显示对象，画布底部始终显示当前绘制数量。超出预算仍可查看精确容量统计。</p>
        <p>超过 10 万条链路时，连线使用标准深度遮挡，并以颜色强度代替透明叠加，减少重复绘制的开销。节点在独立深度阶段绘制，保持可见与可选；链路仍全量提交，没有抽样。</p>
        <p>3D 分层、平面展开、2D 分层与径向布局共享同一张图。节点 ID 为 E-0、T0-0 等；点击节点查看邻接关系，或输入 ID 搜索定位。路径探索支持查看一条最短路径，或显示全部等长最短路径（ECMP）；共享链路合并高亮，结果显示准确的路径总数。</p>
        <h3>参考与边界</h3><p>首版不模拟拥塞控制、发包或论文性能。F16 和 MRC 只作为通用规则的覆盖验证，未针对案例编写专用生成器。</p>
        <div className="reference-links"><a href="https://engineering.fb.com/2019/03/14/data-center-engineering/f16-minipack/" target="_blank" rel="noreferrer">Meta F16 / Minipack ↗</a>
          <a href="https://cdn.openai.com/pdf/resilient-ai-supercomputer-networking-using-mrc-and-srv6.pdf" target="_blank" rel="noreferrer">MRC & SRv6 论文 ↗</a></div>
      </div>
    </dialog>
  </div>;
}
