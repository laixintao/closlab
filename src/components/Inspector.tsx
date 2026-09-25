import { ArrowDownUp, ArrowUpRight, Check, CircleDot, Crosshair, GitBranch, Info, X } from 'lucide-react';
import { nodeInfo, nodeLabel } from '../model/engine';
import { formatBandwidth, formatCount, ratio } from '../model/format';
import { nodeColor, TIER_COLORS } from '../render/colors';
import type { CapacitySummary, Filter, PathSet, TopologyBuffers, TopologySpec, ViewConfig } from '../model/types';
import { useState } from 'react';

export default function Inspector({ spec, summary, graph, colorBy, selected, onSelect, filter, setFilter, path, allPaths, pathBusy, onPath, onClearPath }:
  { spec: TopologySpec; summary: CapacitySummary | null; graph: TopologyBuffers | null; selected: number | null;
    colorBy: ViewConfig['colorBy'];
    onSelect: (id: number | null, focus?: boolean) => void; filter: Filter; setFilter: (filter: Filter) => void;
    path: number[]; allPaths: PathSet | null; pathBusy: boolean;
    onPath: (source: string, target: string, all?: boolean) => void; onClearPath: () => void }) {
  const [source, setSource] = useState('E-0'), [target, setTarget] = useState('E-1');
  const info = graph && selected !== null ? nodeInfo(graph, spec, selected) : null;
  const pods = summary ? Number(spec.tiers.length === 2 ? summary.groups[0] : summary.groups[1]) : 0;
  const autoPlanes = graph?.colorGroupKind === 'connection';
  const planeCount = Math.max(1, graph?.colorGroupCount ?? spec.planes);
  return <aside className="inspector">
    <div className="panel-heading"><div><CircleDot size={15} /><strong>{info ? '节点详情' : '网络概览'}</strong></div>
      {info ? <button className="icon-button" aria-label="关闭节点详情" onClick={() => onSelect(null)}><X size={14} /></button> : <span className="tiny-badge">LIVE</span>}
    </div>
    <div className="inspector-scroll">
      {info && graph ? <section className="inspector-section node-inspector">
        <div className="node-title"><span style={{ background: nodeColor(graph, info.index, colorBy) }} /><h2>{info.label}</h2>
          <button className="icon-button" aria-label="聚焦选中节点" onClick={() => onSelect(info.index, true)}><Crosshair size={15} /></button></div>
        <dl className="detail-list">
          <div><dt>设备类型</dt><dd>{info.tier < 0 ? '终端 / NIC' : 'Tier ' + info.tier + ' 交换机'}</dd></div>
          <div><dt>所属平面</dt><dd>{graph.colorGroupKind === 'tier' ? '单平面' : graph.colorGroup[info.index] < 0
            ? '所有平面共享' : (autoPlanes ? '自动平面 P' : 'Plane ') + graph.colorGroup[info.index]}</dd></div>
          <div><dt>所属 Pod</dt><dd>{info.pod < 0 ? '跨 Pod 共享' : 'Pod ' + info.pod}</dd></div>
          <div><dt>端口占用</dt><dd>{info.usedPorts} / {info.totalPorts}</dd></div>
          <div><dt>预留端口</dt><dd>{info.reservedPorts}</dd></div>
        </dl>
        <div className="subheading">直连邻居 <span>{info.neighbors.length}</span></div>
        <div className="neighbor-list">{info.neighbors.slice(0, 24).map(n => <button key={n} onClick={() => onSelect(n, true)}>{nodeLabel(graph, n)}<ArrowUpRight size={11} /></button>)}</div>
        {info.neighbors.length > 24 && <p className="field-hint">显示前 24 个邻居；画布高亮全部 {info.neighbors.length} 条连接。</p>}
        <div className="node-actions"><button onClick={() => { setSource(info.label); onClearPath(); }}>设为源节点</button><button onClick={() => { setTarget(info.label); onClearPath(); }}>设为目的节点</button></div>
      </section> : <>
        <section className="inspector-section">
          <div className="subheading">设备构成 <span>NODES</span></div>
          {summary && <div className="composition-list">
            <div><i style={{ background: TIER_COLORS[0] }} /><span>终端</span><strong>{formatCount(summary.endpoints)}</strong></div>
            {summary.switches.map((count, i) => <div key={i}><i style={{ background: TIER_COLORS[i + 1] }} />
              <span>T{i} <small>{i === 0 ? '接入层' : i === spec.tiers.length - 1 ? '顶层' : '汇聚层'}</small></span><strong>{formatCount(count)}</strong></div>)}
          </div>}
          <div className="composition-bar">{summary && [summary.endpoints, ...summary.switches].map((n, i) =>
            <span key={i} style={{ background: TIER_COLORS[i], flexGrow: ratio(n, summary.totalNodes), minWidth: 3 }} />)}</div>
        </section>
        <section className="inspector-section">
          <div className="subheading">容量与连接 <ArrowDownUp size={13} /></div>
          {summary && <dl className="detail-list">
            <div><dt>最大终端容量</dt><dd>{formatCount(summary.maxEndpoints)}</dd></div>
            <div><dt>已安装接入槽位</dt><dd>{formatCount(summary.endpointSlots)}</dd></div>
            <div><dt>接入槽位利用率</dt><dd>{ratio(summary.endpoints, summary.endpointSlots).toFixed(1)}%</dd></div>
            <div><dt>每终端带宽</dt><dd>{formatBandwidth(summary.endpointMbps)}</dd></div>
            <div><dt>终端接入链路</dt><dd>{formatCount(summary.links[0])}</dd></div>
            <div><dt>交换机间链路</dt><dd>{formatCount(summary.totalLinks - summary.links[0])}</dd></div>
            <div><dt>{autoPlanes ? '自动平面 / 层数' : '平面 / 层数'}</dt><dd>{planeCount} / {spec.tiers.length}</dd></div>
          </dl>}
          <div className="info-note"><Info size={13} /><span>带宽按单向端口容量计量。每条双向连接只计一条链路。</span></div>
        </section>
      </>}
      <section className="inspector-section">
        <div className="subheading">视图筛选 <button className="text-button" onClick={() => setFilter({ tier: null, plane: null, pod: null })}>清除</button></div>
        <div className="filter-grid">
          <label className="field"><span>层级</span><select aria-label="筛选层级" value={filter.tier ?? 'all'} onChange={e => setFilter({ ...filter, tier: e.target.value === 'all' ? null : Number(e.target.value) })}>
            <option value="all">全部层级</option><option value={-1}>终端</option>{spec.tiers.map((_, i) => <option key={i} value={i}>Tier {i}</option>)}
          </select></label>
          <label className="field"><span>平面</span><select aria-label="筛选平面" value={filter.plane ?? 'all'} onChange={e => setFilter({ ...filter, plane: e.target.value === 'all' ? null : Number(e.target.value) })}>
            <option value="all">全部平面</option>{Array.from({ length: planeCount }, (_, i) => <option key={i} value={i}>{autoPlanes ? '自动平面 P' : 'Plane '}{i}</option>)}
          </select></label>
        </div>
        <label className="field pod-filter"><span>Pod 编号 <small>留空查看全部</small></span>
          <input aria-label="筛选 Pod" type="number" min={0} max={Math.max(0, pods - 1)} placeholder="全部 Pod" value={filter.pod ?? ''}
            onChange={e => setFilter({ ...filter, pod: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      </section>
      <section className="inspector-section">
        <div className="subheading">路径探索 <GitBranch size={13} /></div>
        <div className="path-inputs">
          <label><i className="dot teal" /><input aria-label="源节点" value={source} onChange={e => { setSource(e.target.value); onClearPath(); }} placeholder="E-0" /></label>
          <div className="path-connector" />
          <label><i className="dot violet" /><input aria-label="目的节点" value={target} onChange={e => { setTarget(e.target.value); onClearPath(); }} placeholder="E-1" /></label>
        </div>
        <div className="path-actions">
          <button className="secondary-button full-width" disabled={!graph || pathBusy} onClick={() => onPath(source, target)}>查看最短路径<ArrowUpRight size={13} /></button>
          <button className="secondary-button full-width" title="高亮源节点到目的节点的所有等长最短路径（ECMP）" disabled={!graph || pathBusy} onClick={() => onPath(source, target, true)}>显示所有路径<GitBranch size={13} /></button>
        </div>
        {pathBusy && <p className="field-hint" role="status">正在计算路径…</p>}
        {allPaths && graph && <div className="path-result" data-testid="all-paths-result">
          <span><Check size={12} /> {formatCount(allPaths.count)} 条等长最短路径 · 每条 {allPaths.distance} 跳</span>
          <p>{nodeLabel(graph, allPaths.source)} → {nodeLabel(graph, allPaths.target)}</p>
          <p>已高亮 {formatCount(allPaths.nodes.length)} 个节点、{formatCount(allPaths.edges.length)} 条不同链路。</p>
        </div>}
        {path.length > 0 && graph && <div className="path-result"><span><Check size={12} /> {path.length - 1} 条链路 · {path.slice(1, -1).filter(n => graph.tier[n] >= 0).length} 个中间交换机</span>
          <p>{path.map(n => nodeLabel(graph, n)).join(' → ')}</p></div>}
      </section>
      {summary && summary.warnings.length > 0 && <section className="inspector-section notes-section">
        <div className="subheading">规划提示</div>{summary.warnings.map((warning, i) => <p key={i}><Info size={12} />{warning}</p>)}
      </section>}
    </div>
    <div className="inspector-footer"><span className="status-dot" /> 确定性生成 · 无节点抽样</div>
  </aside>;
}
