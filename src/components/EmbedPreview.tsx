import { Expand, ExternalLink, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { LocalizedText } from '../i18n/core';
import { nodeLabel } from '../model/engine';
import { formatBandwidth, formatCount } from '../model/format';
import { EMPTY_FILTER, type CapacitySummary, type FrameStats, type LayoutResult, type TopologyBuffers, type TopologySpec, type ViewConfig } from '../model/types';
import { NetworkCanvas, type CanvasHandle } from './NetworkCanvas';

const NO_PATH: number[] = [];
export default function EmbedPreview({ spec, view, summary, graph, layout, busy, error }: {
  spec: TopologySpec; view: ViewConfig; summary: CapacitySummary | null;
  graph: TopologyBuffers | null; layout: LayoutResult | null; busy: boolean; error: LocalizedText;
}) {
  const { t, text } = useI18n();
  const root = useRef<HTMLDivElement>(null), canvas = useRef<CanvasHandle>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [renderError, setRenderError] = useState<LocalizedText>('');
  const [stats, setStats] = useState<FrameStats | null>(null);
  const planes = Math.max(1, graph?.colorGroupCount ?? spec.planes);
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch { /* The host blog may disable fullscreen; the preview stays interactive. */ }
  };
  return <div ref={root} className="embed-shell" data-testid="embed-preview">
    <header className="embed-heading"><a className="embed-home" href={new URL('./', window.location.href).href}
      target="_blank" rel="noopener noreferrer" aria-label={t('ClosLab home')} title={t('ClosLab home')}>
      <strong>ClosLab</strong><ExternalLink size={13} /></a>
      {!error && <span>{t(planes === 1 ? '{tiers} tiers · {planes} plane' : '{tiers} tiers · {planes} planes', { tiers: spec.tiers.length, planes })}</span>}
      <div className="embed-view-actions"><button className="icon-button" aria-label={t('Reset view')} title={t('Reset view')} onClick={() => canvas.current?.reset()}><RotateCcw size={16} /></button>
        <button className="icon-button" aria-label={t('Fullscreen preview')} title={t('Fullscreen preview')} onClick={() => void fullscreen()}><Expand size={16} /></button></div>
    </header>
    {!error && <dl className="embed-metrics" aria-label={t('Network statistics')}>
      <div><dt>{t('Endpoints')}</dt><dd data-testid="endpoint-count">{summary ? formatCount(summary.endpoints) : '—'}</dd></div>
      <div><dt>{t('Switches')}</dt><dd data-testid="switch-count">{summary ? formatCount(summary.switchCount) : '—'}</dd></div>
      <div><dt>{t('Physical links')}</dt><dd data-testid="link-count">{summary ? formatCount(summary.totalLinks) : '—'}</dd></div>
      <div><dt>{t('Injection bandwidth')}</dt><dd data-testid="bandwidth">{summary ? formatBandwidth(summary.injectionMbps) : '—'}</dd></div>
    </dl>}
    <div className="embed-canvas">
      {!error && <NetworkCanvas ref={canvas} graph={graph} layout={layout} view={view} filter={EMPTY_FILTER}
        selected={selected} path={NO_PATH} allPaths={null} onPick={setSelected} onStats={setStats} onError={setRenderError} />}
      {selected !== null && graph && <div className="embed-selection">{nodeLabel(graph, selected)}
        <span>{t('· Direct links: {count}', { count: graph.adjacencyOffsets[selected + 1] - graph.adjacencyOffsets[selected] })}</span>
        <button className="icon-button" aria-label={t('Clear selection')} onClick={() => setSelected(null)}><X size={14} /></button></div>}
      {busy && !error && <div className="embed-notice" role="status"><LoaderCircle size={18} className="spin" />{t('Building network')}</div>}
      {(error || renderError) && <div className="embed-notice error-text" role="alert">{text(error || renderError)}</div>}
      {!busy && !error && summary && !summary.canRender && <div className="embed-notice">{t('Capacity calculated; rendering limit exceeded')}</div>}
    </div>
    {!error && <footer className="embed-parameters" aria-label={t('Key parameters')}>
      <div className="embed-parameter-heading"><span>{t('Key parameters')}</span>
        {summary && <span>{t('One-way · {bandwidth} per endpoint', { bandwidth: formatBandwidth(summary.endpointMbps) })}</span>}</div>
      <table><thead><tr><th>{t('Tier')}</th><th>{t('Ports × speed')}</th><th>{t('ASIC bandwidth')}</th><th>{t('Down / Up')}</th></tr></thead>
        <tbody>{spec.tiers.map((tier, i) => <tr key={i}><td>T{i}</td><td>{tier.ports * tier.breakout} × {tier.portGbps} Gbps</td><td>{tier.chipTbps} Tbps</td><td>{tier.down} / {tier.up}</td></tr>)}</tbody></table>
    </footer>}
    <span className="visually-hidden" data-testid="render-status" data-ready={!busy && !error && !renderError && !!graph && !!stats?.visibleNodes}
      data-nodes={stats?.visibleNodes ?? 0} data-links={stats?.visibleEdges ?? 0} />
  </div>;
}
