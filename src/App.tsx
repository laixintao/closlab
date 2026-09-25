import { useI18n } from './i18n/I18nProvider';
import { errorText, LocalizedError, msg, type LocalizedText, type MessageKey } from './i18n/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Box, Check, ChevronDown, CircleHelp, Expand,
  Gauge, GitBranch, Languages, Layers3, Link2, LoaderCircle, Maximize, Minimize, MousePointer2, Network, Pause, Play, RotateCcw, Scan, Search, SlidersHorizontal, X } from 'lucide-react';
import ConfigPanel from './components/ConfigPanel';
import Inspector, { type PathEndpoint, type PathInputs } from './components/Inspector';
import { NetworkCanvas, type CanvasHandle } from './components/NetworkCanvas';
import { DEFAULT_SPEC } from './model/defaults';
import { calculate, findNode, nodeLabel, SpecError } from './model/engine';
import { formatBandwidth, formatCount } from './model/format';
import { parseProject, serializeProject } from './model/project';
import { projectFromQuery, projectToQuery } from './model/url';
import { DEFAULT_VIEW, DEPTH_LINK_THRESHOLD, EMPTY_FILTER, type BenchmarkResult, type CapacitySummary, type Diagnostic, type Filter,
  type FrameStats, type LayoutMode, type LayoutResult, type PathSet, type SavedProject, type TopologyBuffers, type TopologySpec, type ViewConfig } from './model/types';
import { TopologyClient } from './workers/client';
import { groupColor, SHARED_COLOR, TIER_COLORS, usesGroupColors, usesPodColors } from './render/colors';

interface Result {
  spec: TopologySpec; summary: CapacitySummary; graph: TopologyBuffers | null;
  layout: LayoutResult | null; elapsedMs: number;
}
const STORAGE_KEY = 'closlab.project.v1';
const LAYOUT_LABELS: Record<LayoutMode, MessageKey> = { layered: "3D layered", planes: "Expanded planes", flat: "2D layered", radial: "Radial" };
function initialProject(): SavedProject & { urlError?: LocalizedText } {
  const defaults: SavedProject = { format: 'closlab', version: 1, spec: structuredClone(DEFAULT_SPEC), view: { ...DEFAULT_VIEW } };
  try {
    const shared = projectFromQuery(window.location.search);
    if (shared) return shared;
  } catch (error) {
    return { ...defaults, urlError: msg('Invalid share-link parameters; defaults loaded: {error}', { error: errorText(error) }) };
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
  const { t, text, locale, setLocale } = useI18n();
  const [initial] = useState(initialProject);
  const [draft, setDraft] = useState<TopologySpec>(initial.spec);
  const [applied, setApplied] = useState<TopologySpec>(initial.spec);
  const [view, setView] = useState<ViewConfig>(initial.view);
  const [result, setResult] = useState<Result | null>(null);
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [busy, setBusy] = useState(true), [layoutBusy, setLayoutBusy] = useState(false);
  const [message, setMessage] = useState<LocalizedText>(''), [renderError, setRenderError] = useState<LocalizedText>('');
  const [urlError, setUrlError] = useState(initial.urlError ?? ''), [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<number | null>(null), [path, setPath] = useState<number[]>([]);
  const [allPaths, setAllPaths] = useState<PathSet | null>(null), [pathBusy, setPathBusy] = useState(false);
  const [pathInputs, setPathInputs] = useState<PathInputs>({ source: 'E-0', target: 'E-1' });
  const [pickingPathEndpoint, setPickingPathEndpoint] = useState<PathEndpoint | null>(null);
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
    catch (error) { return error instanceof SpecError ? error.diagnostics : [{ field: 'spec', message: errorText(error) }]; }
  }, [draft]);

  useEffect(() => {
    const worker = new TopologyClient(); client.current = worker;
    let cancelled = false;
    setBusy(true); setResult(null); setLayout(null); setMessage(''); setRenderError('');
    setSelected(null); setPath([]); setFilter({ ...EMPTY_FILTER }); setRotating(false); setBenchmark(null);
    setAllPaths(null); setPathBusy(false); setPickingPathEndpoint(null);
    pathRequest.current++;
    worker.request<Result>('build', { spec: applied, layout: viewRef.current.layout }).then(next => {
      if (cancelled) return;
      setResult(next); setLayout(next.layout); setBusy(false);
    }).catch(error => { if (!cancelled) { setMessage(errorText(error)); setBusy(false); } });
    return () => { cancelled = true; worker.dispose(); if (client.current === worker) client.current = null; };
  }, [applied]);
  useEffect(() => {
    if (!result?.graph || !client.current) return;
    let cancelled = false;
    setLayoutBusy(true); setRotating(false);
    client.current.request<LayoutResult>('layout', { mode: view.layout }).then(next => {
      if (!cancelled) { setLayout(next); setLayoutBusy(false); }
    }).catch(error => { if (!cancelled) { setMessage(errorText(error)); setLayoutBusy(false); } });
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
      if (event.key === 'Escape') { setFocused(false); setSelected(null); setPath([]); setAllPaths(null); setPathBusy(false); setPickingPathEndpoint(null); pathRequest.current++; }
    };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const updateView = (patch: Partial<ViewConfig>) => setView(v => ({ ...v, ...patch }));
  const clearPaths = () => { setPath([]); setAllPaths(null); setPathBusy(false); setPickingPathEndpoint(null); pathRequest.current++; };
  const updatePathInput = (endpoint: PathEndpoint, value: string) => {
    setPathInputs(inputs => ({ ...inputs, [endpoint]: value })); clearPaths();
  };
  const startPathPick = (endpoint: PathEndpoint | null) => { clearPaths(); setPickingPathEndpoint(endpoint); };
  const selectNode = (id: number | null, focus = false) => {
    setSelected(id); clearPaths();
    if (focus && id !== null) { setFilter({ ...EMPTY_FILTER }); canvas.current?.focus(id); }
  };
  const pickCanvasNode = (id: number | null) => {
    if (pickingPathEndpoint) {
      if (id !== null && result?.graph) updatePathInput(pickingPathEndpoint, nodeLabel(result.graph, id));
      return;
    }
    selectNode(id);
  };
  const search = () => {
    if (!result?.graph) return;
    const id = findNode(result.graph, query);
    if (id === null) { setMessage(msg("Node not found. Use E-0, T0-0, or a numeric node ID.")); return; }
    setMessage(''); selectNode(id, true);
  };
  const showPath = async (source: string, target: string, all = false) => {
    if (!result?.graph || !client.current) return;
    clearPaths();
    const a = findNode(result.graph, source), b = findNode(result.graph, target);
    if (a === null || b === null) { setMessage(msg("Path endpoint not found. Check the source and destination node IDs.")); return; }
    const request = ++pathRequest.current;
    setPathBusy(true); setMessage('');
    try {
      if (all) {
        const paths = await client.current.request<PathSet>('allPaths', { source: a, target: b });
        if (request !== pathRequest.current) return;
        setAllPaths(paths.count > 0n ? paths : null);
        setMessage(paths.count > 0n ? '' : msg("No path is available between these nodes."));
      } else {
        const nodes = await client.current.request<number[]>('path', { source: a, target: b });
        if (request !== pathRequest.current) return;
        setPath(nodes); setMessage(nodes.length ? '' : msg("No path is available between these nodes."));
      }
      setSelected(null); setFilter({ ...EMPTY_FILTER });
    } catch (error) {
      if (request === pathRequest.current) setMessage(errorText(error, "Path calculation failed"));
    } finally {
      if (request === pathRequest.current) setPathBusy(false);
    }
  };
  const importProject = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 65536) throw new LocalizedError(msg("Configuration files must not exceed 64 KB"));
      const project = parseProject(await file.text()); calculate(project.spec);
      setDraft(project.spec); setApplied(structuredClone(project.spec)); setView(project.view);
      setUrlError('');
      setMessage('');
    } catch (error) { setMessage(errorText(error, "Import failed")); }
    if (fileInput.current) fileInput.current.value = '';
  };
  const runBenchmark = async () => {
    if (!canvas.current) return;
    setBenchmarkBusy(true); setBenchmark(null); setMessage('');
    setSelected(null); clearPaths();
    try { setBenchmark(await canvas.current.benchmark()); }
    catch (error) { setMessage(errorText(error, "Benchmark failed")); }
    finally { setBenchmarkBusy(false); }
  };
  const copyShareLink = async () => {
    const url = new URL(window.location.href); url.search = projectToQuery(applied, view);
    try { await navigator.clipboard.writeText(url.href); setCopied(true); }
    catch { setMessage(msg("Could not copy automatically. Copy the network link from the address bar.")); }
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
      <a href="./" className="brand" aria-label={t("ClosLab home")}><img src="/favicon.svg" alt="" /><strong>ClosLab</strong></a>
      <h1 className="workspace-title">{t("Fabric workbench")}</h1>
      <nav className="header-actions">
        <label className="language-switch"><Languages size={15} />
          <select aria-label={t('Language')} value={locale} onChange={e => setLocale(e.target.value as 'en' | 'zh-CN')}>
            <option value="en" lang="en">English</option><option value="zh-CN" lang="zh-CN">中文</option>
          </select>
        </label>
        <button className="quiet-button" aria-label={t("Model guide")} onClick={() => setHelp(true)}><CircleHelp size={15} /><span>{t("Model guide")}</span></button>
        <button className="quiet-button" aria-label={t("Import")} onClick={() => fileInput.current?.click()}><ArrowUpFromLine size={15} /><span>{t("Import")}</span></button>
        <button className="quiet-button" aria-label={t("Copy share link")} title={t("Copy a share link for the generated network")} onClick={() => void copyShareLink()}>
          {copied ? <Check size={15} /> : <Link2 size={15} />}<span>{copied ? t("Copied") : t("Share")}</span></button>
        <input ref={fileInput} aria-label={t("Import configuration file")} type="file" accept=".json,application/json" hidden onChange={e => void importProject(e.target.files?.[0])} />
      </nav>
    </header>
    <main className="workbench-content">
      <ConfigPanel spec={draft} setSpec={setDraft} errors={errors} busy={busy}
        onApply={() => { if (!errors.length) { setUrlError(''); setApplied(structuredClone(draft)); setTab('topology'); } }}
        onReset={() => setDraft(structuredClone(DEFAULT_SPEC))} />
      <section className="results-section" aria-labelledby="results-heading">
        <div className={'results-heading' + (busy || dirty ? '' : ' is-settled')}><h2 id="results-heading" className="visually-hidden">{t("Results")}</h2>
          {(busy || dirty) && <span className={'results-state' + (dirty ? ' is-pending' : '')} role="status">
            <span className={'status-dot' + (dirty ? ' pending' : '')} />{busy ? t("Generating network…") : t("Unapplied changes · Showing previous results")}</span>}
        </div>
        <section className="metrics" aria-label={t("Network statistics")}>
          <div className="metric"><div><span>{t("Endpoints")}</span></div><strong data-testid="endpoint-count">{summary ? formatCount(summary.endpoints) : '—'}</strong>
            <p>{summary ? t('Maximum capacity {count}', { count: formatCount(summary.maxEndpoints) }) : t("Waiting for capacity calculation")}</p></div>
          <div className="metric"><div><span>{t("Switches")}</span></div><strong data-testid="switch-count">{summary ? formatCount(summary.switchCount) : '—'}</strong>
            <p>{t(naturalGroups ? '{tiers} switch tiers · {planes} auto planes' : colorGroupCount === 1 ? '{tiers} switch tiers · {planes} plane' : '{tiers} switch tiers · {planes} planes', { tiers: currentSpec.tiers.length, planes: Math.max(1, colorGroupCount) })}</p></div>
          <div className="metric"><div><span>{t("Physical links")}</span></div><strong data-testid="link-count">{summary ? formatCount(summary.totalLinks) : '—'}</strong>
            <p>{t("Includes endpoint access and inter-tier links")}</p></div>
          <div className="metric bandwidth-metric"><div><span>{t("Endpoint injection bandwidth")}</span></div><strong data-testid="bandwidth">{summary ? formatBandwidth(summary.injectionMbps) : '—'}</strong>
            <p>{t('One-way · {bandwidth} per endpoint', { bandwidth: summary ? formatBandwidth(summary.endpointMbps) : '—' })}</p></div>
        </section>
        <div className="workbench">
          <section className="workspace-main">
            <div className="workspace-tabs"><div>
              <button className={tab === 'topology' ? 'active' : ''} onClick={() => setTab('topology')}><Network size={14} />{t("Topology")}</button>
              <button className={tab === 'capacity' ? 'active' : ''} onClick={() => setTab('capacity')}><SlidersHorizontal size={14} />{t("Capacity details")}</button>
            </div></div>
            <div className={'canvas-shell' + (focused ? ' is-focused' : '')} style={{ display: tab === 'topology' ? undefined : 'none' }}>
              <div className="canvas-toolbar">
                <div className="layout-select"><Box size={14} /><select aria-label={t("Topology layout")} value={view.layout} onChange={e => updateView({ layout: e.target.value as LayoutMode })}>
                  {Object.entries(LAYOUT_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
                </select><ChevronDown size={12} /></div>
                <div className="toolbar-divider" />
                <div className="segmented line-select"><button className={view.lines === 'straight' ? 'active' : ''} onClick={() => updateView({ lines: 'straight' })}>{t("Straight")}</button>
                  <button className={view.lines === 'elbow' ? 'active' : ''} onClick={() => updateView({ lines: 'elbow' })}>{t("Orthogonal")}</button></div>
                <div className="toolbar-spacer" />
                <form className="node-search" onSubmit={e => { e.preventDefault(); search(); }}><Search size={13} />
                  <input aria-label={t("Search nodes")} value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Find node ID")} />
                  <kbd>↵</kbd></form>
                <button className="reset-view-button" aria-label={t('Reset view')} title={t("Restore initial view")} onClick={() => canvas.current?.reset()}>
                  <RotateCcw size={13} /><span>{t("Reset view")}</span></button>
                <button className="icon-button" title={focused ? t("Exit focus mode") : t("Focus mode")} aria-label={focused ? t("Exit focus mode") : t("Focus mode")} onClick={() => setFocused(v => !v)}>
                  {focused ? <Minimize size={15} /> : <Expand size={15} />}</button>
              </div>
              <div className={'canvas-stage' + (pickingPathEndpoint ? ' is-picking-node' : '')}>
                <NetworkCanvas ref={canvas} graph={result?.graph ?? null} layout={layout} view={view} filter={filter}
                  selected={selected} path={path} allPaths={allPaths} onPick={pickCanvasNode} onStats={setStats} onError={setRenderError} />
                <div className="canvas-top-label"><span className="status-dot" /><span>{hasFilter || !view.showEndpoints ? t("Filtered view") : t("Full topology")}</span>
                  <span className="canvas-label-divider" />{t(colorGroupCount === 1 ? '{tiers} tiers · {planes} plane' : '{tiers} tiers · {planes} planes', { tiers: currentSpec.tiers.length, planes: Math.max(1, colorGroupCount) })}{naturalGroups ? t(' · Auto-detected') : ''}
                  {(result?.graph?.edgeCount ?? 0) > DEPTH_LINK_THRESHOLD && <span>{t('· Depth occlusion')}</span>}</div>
                {view.layout === 'flat' && <div className="pan-hint">{t("Scroll to zoom · Right-drag to pan")}</div>}
                <div className="canvas-legend">{!groupedColors
                  ? [t("Endpoints"), ...currentSpec.tiers.map((_, i) => 'T' + i)].map((label, i) =>
                    <span key={label}><i style={{ background: TIER_COLORS[i] }} />{label}</span>)
                  : <>{(currentSpec.planes > 1 || currentSpec.tiers.length > 2) && <span><i style={{ background: SHARED_COLOR }} />{t("Shared")}</span>}
                    {Array.from({ length: Math.min(colorGroupCount, 8) }, (_, i) =>
                      <span key={i}><i style={{ background: groupColor(i) }} />P{i}</span>)}
                    <span>{naturalGroups ? t('{count} auto planes', { count: colorGroupCount }) : t(colorGroupCount === 1 ? '{count} plane' : '{count} planes', { count: colorGroupCount })}</span>
                    {podColors && <span>{t("Pods below · Planes above")}</span>}</>}</div>
                <div className="canvas-settings">
                  <div className="color-mode" data-testid="color-mode">{podColors ? t("Pod / plane colors · Auto") : groupedColors ? t("Plane colors · Auto") : t("Tier colors · Auto")}</div>
                  <label>{t("Show endpoints")}<input aria-label={t("Show endpoints")} type="checkbox" checked={view.showEndpoints}
                    onChange={e => { updateView({ showEndpoints: e.target.checked }); selectNode(null); }} /></label>
                  <label className="opacity-control">{t("Link intensity")}<input aria-label={t("Link intensity")} type="range" min="0.01" max="0.8" step="0.01"
                    value={view.opacity} onChange={e => updateView({ opacity: Number(e.target.value) })} /></label>
                </div>
                <div className="view-controls">
                  <button className="icon-button" aria-label={t("Reset camera")} title={t("Reset camera")} onClick={() => canvas.current?.reset()}><Maximize size={16} /></button>
                  <button className="icon-button" aria-label={t("Fit all")} title={t("Fit all")} onClick={() => canvas.current?.fit()}><Scan size={16} /></button>
                  <button className={'icon-button' + (rotating ? ' active' : '')} aria-label={rotating ? t("Stop rotation") : t("Auto rotate")} title={t("Auto rotate")}
                    disabled={view.layout === 'flat' || view.layout === 'radial'} onClick={() => setRotating(canvas.current?.toggleRotate() ?? false)}>
                    {rotating ? <Pause size={15} /> : <Play size={15} />}</button>
                  <button className={'icon-button' + (benchmarkBusy ? ' active' : '')} aria-label={t("Run 30-second benchmark")} title={t("Run a 30-second full-topology benchmark")}
                    disabled={benchmarkBusy || !result?.graph || busy || layoutBusy} onClick={() => void runBenchmark()}>
                    {benchmarkBusy ? <LoaderCircle className="spin" size={15} /> : <Gauge size={16} />}</button>
                </div>
                {pickingPathEndpoint && <div className="selection-chip path-pick-prompt" data-testid="path-pick-prompt" role="status">
                  <MousePointer2 size={12} />{t(pickingPathEndpoint === 'source' ? 'Click a node to set the source · Esc to cancel' : 'Click a node to set the destination · Esc to cancel')}
                  <button aria-label={t('Cancel node picking')} onClick={() => setPickingPathEndpoint(null)}><X size={12} /></button>
                </div>}
                {!pickingPathEndpoint && selected !== null && result?.graph && <div className="selection-chip"><MousePointer2 size={12} />{nodeLabel(result.graph, selected)}
                  <span>{t('· Direct links: {count}', { count: result.graph.adjacencyOffsets[selected + 1] - result.graph.adjacencyOffsets[selected] })}</span>
                  <button aria-label={t("Clear selection")} onClick={() => selectNode(null)}><X size={12} /></button></div>}
                {(path.length > 0 || allPaths) && <div className="selection-chip"><GitBranch size={12} />
                  {allPaths ? t('All shortest paths: {count} · Hops per path: {hops}', { count: formatCount(allPaths.count), hops: allPaths.distance }) : t('Path shown · Links: {count}', { count: path.length - 1 })}
                  <button aria-label={t("Clear path")} onClick={clearPaths}><X size={12} /></button></div>}
                {(busy || layoutBusy) && <div className="canvas-progress"><LoaderCircle className="spin" size={16} />{busy ? t("Building network") : t("Calculating layout")}<small>{t("Preserving every node and connection")}</small></div>}
                {!busy && summary && !summary.canRender && <div className="canvas-empty"><Layers3 size={32} /><h2>{t("Capacity calculated; rendering limit exceeded")}</h2>
                  <p>{t('{nodes} nodes · {links} links', { nodes: formatCount(summary.totalNodes), links: formatCount(summary.totalLinks) })}</p><span>{t("Use Target planning with fewer endpoints to render the full network.")}</span></div>}
                {renderError && <div className="canvas-empty error-surface"><h2>{t("Canvas unavailable")}</h2><p>{text(renderError)}</p><span>{t("Capacity statistics remain available.")}</span></div>}
                {benchmarkBusy && <div className="benchmark-running"><span className="status-dot" />{t("Rotating and measuring for 30 seconds…")}</div>}
                {benchmark && <div className="benchmark-result" data-testid="benchmark-result">
                  <div><strong>{t("Full-topology benchmark")}</strong><button className="icon-button" aria-label={t("Close benchmark results")} onClick={() => setBenchmark(null)}><X size={12} /></button></div>
                  <p><b>{benchmark.medianFps.toFixed(1)}</b> {t("Median FPS")} <span>P95 {benchmark.p95FrameMs.toFixed(1)} ms</span></p>
                  <dl><dt>{t("Rendered nodes")}</dt><dd data-testid="benchmark-nodes">{formatCount(benchmark.nodes)}</dd>
                    <dt>{t("Rendered links")}</dt><dd data-testid="benchmark-links">{formatCount(benchmark.links)}</dd>
                    <dt>{t("Submitted segments")}</dt><dd data-testid="benchmark-segments">{formatCount(benchmark.submittedSegments)}</dd>
                    <dt>{t("Canvas / DPR")}</dt><dd>{benchmark.width} × {benchmark.height} / {benchmark.dpr}</dd></dl>
                  <button className="text-button" onClick={() => download(JSON.stringify({ ...benchmark, userAgent: navigator.userAgent, spec: applied, view, generatedAt: new Date().toISOString() }, null, 2), 'closlab-benchmark.json')}>{t("Download benchmark report")} <ArrowDownToLine size={12} /></button>
                </div>}
              </div>
              <div className="canvas-status" data-testid="render-status" data-nodes={stats.visibleNodes} data-links={stats.visibleEdges}
                data-segments={stats.submittedSegments} data-draw-calls={stats.drawCalls}
                data-ready={!busy && !layoutBusy && !!result?.graph && stats.visibleNodes > 0}>
                <div><span className="status-dot" /><span>{t('{count} nodes', { count: formatCount(stats.visibleNodes) })}</span><i>·</i><span>{t('{count} links', { count: formatCount(stats.visibleEdges) })}</span>
                  {hasFilter && <button className="text-button" onClick={() => setFilter({ ...EMPTY_FILTER })}>{t("Clear filters")}</button>}</div>
                <div><span>{stats.fps > 0 ? stats.fps + ' FPS' : t("On-demand rendering")}</span><i>·</i><span>{result ? t('{time} ms build', { time: result.elapsedMs.toFixed(0) }) : '—'}</span></div>
              </div>
            </div>
            {tab === 'capacity' && summary && <div className="capacity-view">
              <div className="capacity-title"><h2>{t("Capacity details")}</h2></div>
              <div className="table-scroll"><table><thead><tr><th>{t("Tier")}</th><th>{t("Switches")}</th><th>{t("Effective ports / switch")}</th><th>{t("Down / Up")}</th><th>{t("Reserved / Unassigned")}</th><th>{t("ASIC bandwidth / switch")}</th></tr></thead>
                <tbody>{currentSpec.tiers.map((p, i) => <tr key={i}><td><i className="table-dot" style={{ background: TIER_COLORS[i + 1] }} />T{i}</td>
                  <td>{formatCount(summary.switches[i])}</td><td>{p.ports * p.breakout}</td><td>{p.down} / {p.up}</td><td>{p.reserved} / {p.ports * p.breakout - p.down - p.up - p.reserved}</td><td>{p.chipTbps} Tbps</td></tr>)}</tbody></table></div>
              <h3>{t("Inter-tier connections")}</h3><div className="table-scroll"><table><thead><tr><th>{t("Boundary")}</th><th>{t("Physical links")}</th><th>{t("Aggregate one-way capacity")}</th><th>{t("Configured down : up")}</th></tr></thead>
                <tbody>{summary.links.map((count, i) => <tr key={i}><td>{i === 0 ? t("Endpoints → T0") : 'T' + (i - 1) + ' → T' + i}</td>
                  <td>{formatCount(count)}</td><td>{formatBandwidth(summary.boundaryMbps[i])}</td><td>{i === 0 ? '—' : (currentSpec.tiers[i - 1].down / currentSpec.tiers[i - 1].up).toFixed(2) + ' : 1'}</td></tr>)}</tbody></table></div>
              <div className="capacity-note"><CircleHelp size={16} /><p>{t("Inter-tier capacity sums every one-way link at a boundary. Injection, inter-tier, and bisection bandwidth measure different things; this tool does not predict workload throughput. Target planning preserves all uplink paths of active groups and allows a partially filled final group.")}</p></div>
            </div>}
          </section>
          <Inspector spec={currentSpec} summary={summary ?? null} graph={result?.graph ?? null} colorBy={view.colorBy} selected={selected} onSelect={selectNode}
            filter={filter} setFilter={setFilter} path={path} allPaths={allPaths} pathBusy={pathBusy}
            onPath={(a, b, all) => void showPath(a, b, all)} pathInputs={pathInputs} onPathInputChange={updatePathInput}
            pickingPathEndpoint={pickingPathEndpoint} onPickPathEndpoint={startPathPick} />
        </div>
      </section>
    </main>
    {(message || urlError) && <div className="toast" role="alert"><CircleHelp size={16} /><span>{text(message || urlError)}</span><button aria-label={t("Dismiss message")} onClick={() => { setMessage(''); setUrlError(''); }}><X size={14} /></button></div>}
    <dialog ref={dialog} className="help-dialog" onClose={() => setHelp(false)}>
      <div className="dialog-heading"><h2>{t("Understand your Clos network")}</h2><button className="icon-button" aria-label={t("Close model guide")} onClick={() => setHelp(false)}><X size={18} /></button></div>
      <div className="dialog-content">
        <h3>{t("Regular, verifiable connections")}</h3><p>{t("Each tier defines downlinks d and uplinks u. The generator groups switches recursively using mixed-radix rules, connects each lower switch to distinct upper switches in its group, and preserves every uplink path. Tiers count switch layers only.")}</p>
        <div className="formula">N<sub>max</sub> = d₀ × d₁ × … × d<sub>t−1</sub></div>
        <p>{t("Target planning fills access groups in ID order and allows empty slots in the final group. Group counts round up at each tier; route choices follow the product of lower-tier uplink counts. This is a feasible configuration under fixed wiring rules, without global optimization for the fewest devices.")}</p>
        <h3>{t("Two plane split boundaries")}</h3><p><b>{t("At endpoint access: ")}</b>{t("Each plane gets a complete switching fabric. Shared endpoints connect to every plane, so bandwidth per endpoint equals the link speed multiplied by the plane count.")}</p>
        <p><b>{t("Above a switch tier: ")}</b>{t("Uplink choices at the boundary split evenly into independent planes. The uplink count must be divisible by the plane count. Lower devices are shared; upper links stay within their plane. Changing the grouping alone does not add devices when port allocation is unchanged.")}</p>
        <h3>{t("Hardware and bandwidth")}</h3><p>{t("Effective ports = physical ports × breakout. Changing ASIC bandwidth, physical ports, or breakout updates logical port speed; it can also be set manually. ASIC bandwidth sums all one-way port capacities. All used logical ports on a switch share one speed, which must match across adjacent tiers.")}</p>
        <p>{t("Each independent point-to-point breakout connection counts as one link. The tool does not infer transceiver, fiber strand, or breakout cable assembly counts.")}</p>
        <h3>{t("Full-topology visualization")}</h3><p>{t("Expand up to 250,000 total nodes and 5,000,000 links. All endpoints and links are submitted to the GPU; distant overlap does not change counts. Only explicit filters reduce the displayed objects. The canvas footer shows current rendered counts, and exact capacity statistics remain available beyond the rendering limit.")}</p>
        <p>{t("Above 500,000 links, standard depth occlusion and color intensity replace transparency blending to reduce overdraw. Nodes render in a separate depth pass to remain visible and selectable. Every link is still submitted, without sampling.")}</p>
        <p>{t("3D layered, expanded planes, 2D layered, and radial layouts share one graph. Node IDs include E-0 and T0-0. Click a node to inspect its neighbors or search by ID. Explore one shortest path or all equal-cost shortest paths (ECMP), with shared links highlighted once and an exact total path count.")}</p>
        <h3>{t("References and scope")}</h3><p>{t("This version does not simulate congestion control, packet transmission, or paper performance results. F16 and MRC validate the general rules; neither uses a dedicated scenario generator.")}</p>
        <div className="reference-links"><a href="https://engineering.fb.com/2019/03/14/data-center-engineering/f16-minipack/" target="_blank" rel="noreferrer">Meta F16 / Minipack ↗</a>
          <a href="https://cdn.openai.com/pdf/resilient-ai-supercomputer-networking-using-mrc-and-srv6.pdf" target="_blank" rel="noreferrer">{t("MRC & SRv6 paper ↗")}</a></div>
      </div>
    </dialog>
  </div>;
}
