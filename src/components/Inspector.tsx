import { useI18n } from '../i18n/I18nProvider';
import { ArrowDownUp, ArrowUpRight, Check, CircleDot, Crosshair, GitBranch, Info, X } from 'lucide-react';
import { nodeInfo, nodeLabel } from '../model/engine';
import { formatBandwidth, formatCount, ratio } from '../model/format';
import { nodeColor, TIER_COLORS } from '../render/colors';
import type { CapacitySummary, Filter, PathSet, TopologyBuffers, TopologySpec, ViewConfig } from '../model/types';

export type PathEndpoint = 'source' | 'target';
export type PathInputs = Record<PathEndpoint, string>;

export default function Inspector({ spec, summary, graph, colorBy, selected, onSelect, filter, setFilter, path, allPaths, pathBusy, onPath,
  pathInputs, onPathInputChange, pickingPathEndpoint, onPickPathEndpoint }:
  { spec: TopologySpec; summary: CapacitySummary | null; graph: TopologyBuffers | null; selected: number | null;
    colorBy: ViewConfig['colorBy'];
    onSelect: (id: number | null, focus?: boolean) => void; filter: Filter; setFilter: (filter: Filter) => void;
    path: number[]; allPaths: PathSet | null; pathBusy: boolean;
    onPath: (source: string, target: string, all?: boolean) => void;
    pathInputs: PathInputs; onPathInputChange: (endpoint: PathEndpoint, value: string) => void;
    pickingPathEndpoint: PathEndpoint | null; onPickPathEndpoint: (endpoint: PathEndpoint | null) => void }) {
  const { t, text } = useI18n();
  const { source, target } = pathInputs;
  const info = graph && selected !== null ? nodeInfo(graph, spec, selected) : null;
  const pods = summary ? Number(spec.tiers.length === 2 ? summary.groups[0] : summary.groups[1]) : 0;
  const autoPlanes = graph?.colorGroupKind === 'connection';
  const planeCount = Math.max(1, graph?.colorGroupCount ?? spec.planes);
  return <aside className="inspector">
    <div className="panel-heading"><div><CircleDot size={15} /><strong>{info ? t("Node details") : t("Network overview")}</strong></div>
      {info ? <button className="icon-button" aria-label={t("Close node details")} onClick={() => onSelect(null)}><X size={14} /></button> : <span className="tiny-badge">{t("LIVE")}</span>}
    </div>
    <div className="inspector-scroll">
      {info && graph ? <section className="inspector-section node-inspector">
        <div className="node-title"><span style={{ background: nodeColor(graph, info.index, colorBy) }} /><h2>{info.label}</h2>
          <button className="icon-button" aria-label={t("Focus selected node")} onClick={() => onSelect(info.index, true)}><Crosshair size={15} /></button></div>
        <dl className="detail-list">
          <div><dt>{t("Device type")}</dt><dd>{info.tier < 0 ? t("Endpoint / NIC") : t('Tier {tier} switch', { tier: info.tier })}</dd></div>
          <div><dt>{t("Plane membership")}</dt><dd>{graph.colorGroupKind === 'tier' ? t("Single plane") : graph.colorGroup[info.index] < 0
            ? t("Shared by all planes") : t(autoPlanes ? 'Auto plane P{plane}' : 'Plane {plane}', { plane: graph.colorGroup[info.index] })}</dd></div>
          <div><dt>{t("Pod membership")}</dt><dd>{info.pod < 0 ? t("Shared across Pods") : 'Pod ' + info.pod}</dd></div>
          <div><dt>{t("Ports in use")}</dt><dd>{info.usedPorts} / {info.totalPorts}</dd></div>
          <div><dt>{t("Reserved ports")}</dt><dd>{info.reservedPorts}</dd></div>
        </dl>
        <div className="subheading">{t("Direct neighbors")} <span>{info.neighbors.length}</span></div>
        <div className="neighbor-list">{info.neighbors.slice(0, 24).map(n => <button key={n} onClick={() => onSelect(n, true)}>{nodeLabel(graph, n)}<ArrowUpRight size={11} /></button>)}</div>
        {info.neighbors.length > 24 && <p className="field-hint">{t('Showing the first 24 neighbors; all {count} connections are highlighted.', { count: info.neighbors.length })}</p>}
        <div className="node-actions"><button onClick={() => onPathInputChange('source', info.label)}>{t("Set as source")}</button><button onClick={() => onPathInputChange('target', info.label)}>{t("Set as destination")}</button></div>
      </section> : <>
        <section className="inspector-section">
          <div className="subheading">{t("Node composition")} <span>{t("NODES")}</span></div>
          {summary && <div className="composition-list">
            <div><i style={{ background: TIER_COLORS[0] }} /><span>{t("Endpoints")}</span><strong>{formatCount(summary.endpoints)}</strong></div>
            {summary.switches.map((count, i) => <div key={i}><i style={{ background: TIER_COLORS[i + 1] }} />
              <span>T{i} <small>{i === 0 ? t("Access tier") : i === spec.tiers.length - 1 ? t("Top") : t("Aggregation tier")}</small></span><strong>{formatCount(count)}</strong></div>)}
          </div>}
          <div className="composition-bar">{summary && [summary.endpoints, ...summary.switches].map((n, i) =>
            <span key={i} style={{ background: TIER_COLORS[i], flexGrow: ratio(n, summary.totalNodes), minWidth: 3 }} />)}</div>
        </section>
        <section className="inspector-section">
          <div className="subheading">{t("Capacity and links")} <ArrowDownUp size={13} /></div>
          {summary && <dl className="detail-list">
            <div><dt>{t("Maximum endpoints")}</dt><dd>{formatCount(summary.maxEndpoints)}</dd></div>
            <div><dt>{t("Installed access slots")}</dt><dd>{formatCount(summary.endpointSlots)}</dd></div>
            <div><dt>{t("Access slot utilization")}</dt><dd>{ratio(summary.endpoints, summary.endpointSlots).toFixed(1)}%</dd></div>
            <div><dt>{t("Bandwidth per endpoint")}</dt><dd>{formatBandwidth(summary.endpointMbps)}</dd></div>
            <div><dt>{t("Endpoint access links")}</dt><dd>{formatCount(summary.links[0])}</dd></div>
            <div><dt>{t("Inter-switch links")}</dt><dd>{formatCount(summary.totalLinks - summary.links[0])}</dd></div>
            <div><dt>{autoPlanes ? t("Auto planes / tiers") : t("Planes / tiers")}</dt><dd>{planeCount} / {spec.tiers.length}</dd></div>
          </dl>}
          <div className="info-note"><Info size={13} /><span>{t("Bandwidth uses one-way port capacity. Each bidirectional connection counts as one link.")}</span></div>
        </section>
      </>}
      <section className="inspector-section">
        <div className="subheading">{t("View filters")} <button className="text-button" onClick={() => setFilter({ tier: null, plane: null, pod: null })}>{t("Clear")}</button></div>
        <div className="filter-grid">
          <label className="field"><span>{t("Tier")}</span><select aria-label={t("Filter tier")} value={filter.tier ?? 'all'} onChange={e => setFilter({ ...filter, tier: e.target.value === 'all' ? null : Number(e.target.value) })}>
            <option value="all">{t("All tiers")}</option><option value={-1}>{t("Endpoints")}</option>{spec.tiers.map((_, i) => <option key={i} value={i}>Tier {i}</option>)}
          </select></label>
          <label className="field"><span>{t("Plane")}</span><select aria-label={t("Filter plane")} value={filter.plane ?? 'all'} onChange={e => setFilter({ ...filter, plane: e.target.value === 'all' ? null : Number(e.target.value) })}>
            <option value="all">{t("All planes")}</option>{Array.from({ length: planeCount }, (_, i) => <option key={i} value={i}>{t(autoPlanes ? 'Auto plane P{plane}' : 'Plane {plane}', { plane: i })}</option>)}
          </select></label>
        </div>
        <label className="field pod-filter"><span>{t("Pod ID")} <small>{t("Leave blank for all")}</small></span>
          <input aria-label={t("Filter Pod")} type="number" min={0} max={Math.max(0, pods - 1)} placeholder={t("All Pods")} value={filter.pod ?? ''}
            onChange={e => setFilter({ ...filter, pod: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      </section>
      <section className="inspector-section">
        <div className="subheading">{t("Path explorer")} <GitBranch size={13} /></div>
        <div className="path-inputs">
          <div className={'path-endpoint' + (pickingPathEndpoint === 'source' ? ' is-picking' : '')}>
            <i className="dot teal" /><input aria-label={t("Source node")} value={source} placeholder="E-0"
              onClick={() => graph && onPickPathEndpoint('source')} onChange={e => onPathInputChange('source', e.target.value)} />
            <button className="icon-button path-pick-button" aria-label={t('Pick source from graph')} title={t('Pick source from graph')}
              aria-pressed={pickingPathEndpoint === 'source'} disabled={!graph}
              onClick={() => onPickPathEndpoint(pickingPathEndpoint === 'source' ? null : 'source')}><Crosshair size={15} /></button>
          </div>
          <div className="path-connector" />
          <div className={'path-endpoint' + (pickingPathEndpoint === 'target' ? ' is-picking' : '')}>
            <i className="dot violet" /><input aria-label={t("Destination node")} value={target} placeholder="E-1"
              onClick={() => graph && onPickPathEndpoint('target')} onChange={e => onPathInputChange('target', e.target.value)} />
            <button className="icon-button path-pick-button" aria-label={t('Pick destination from graph')} title={t('Pick destination from graph')}
              aria-pressed={pickingPathEndpoint === 'target'} disabled={!graph}
              onClick={() => onPickPathEndpoint(pickingPathEndpoint === 'target' ? null : 'target')}><Crosshair size={15} /></button>
          </div>
        </div>
        <div className="path-actions">
          <button className="secondary-button full-width" disabled={!graph || pathBusy} onClick={() => onPath(source, target)}>{t("View shortest path")}<ArrowUpRight size={13} /></button>
          <button className="secondary-button full-width" title={t("Highlight all equal-cost shortest paths between the source and destination (ECMP)")} disabled={!graph || pathBusy} onClick={() => onPath(source, target, true)}>{t("Show all paths")}<GitBranch size={13} /></button>
        </div>
        {pathBusy && <p className="field-hint" role="status">{t("Finding paths…")}</p>}
        {allPaths && graph && <div className="path-result" data-testid="all-paths-result">
          <span><Check size={12} /> {t('Shortest paths: {count} · Hops per path: {hops}', { count: formatCount(allPaths.count), hops: allPaths.distance })}</span>
          <p>{nodeLabel(graph, allPaths.source)} → {nodeLabel(graph, allPaths.target)}</p>
          <p>{t('Highlighted nodes: {nodes} · Unique links: {links}.', { nodes: formatCount(allPaths.nodes.length), links: formatCount(allPaths.edges.length) })}</p>
        </div>}
        {path.length > 0 && graph && <div className="path-result"><span><Check size={12} /> {t('Links: {links} · Intermediate switches: {switches}', { links: path.length - 1, switches: path.slice(1, -1).filter(n => graph.tier[n] >= 0).length })}</span>
          <p>{path.map(n => nodeLabel(graph, n)).join(' → ')}</p></div>}
      </section>
      {summary && summary.warnings.length > 0 && <section className="inspector-section notes-section">
        <div className="subheading">{t("Planning notes")}</div>{summary.warnings.map((warning, i) => <p key={i}><Info size={12} />{text(warning)}</p>)}
      </section>}
    </div>
    <div className="inspector-footer"><span className="status-dot" /> {t("Deterministic generation · No node sampling")}</div>
  </aside>;
}
