import { useI18n } from '../i18n/I18nProvider';
import { errorText, LocalizedError, msg, type LocalizedText } from '../i18n/core';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { NetworkScene } from '../render/NetworkScene';
import type { BenchmarkResult, Filter, FrameStats, LayoutResult, PathSet, TopologyBuffers, ViewConfig } from '../model/types';

export interface CanvasHandle {
  reset: () => void;
  fit: () => void;
  focus: (id: number) => void;
  toggleRotate: () => boolean;
  benchmark: () => Promise<BenchmarkResult>;
}
export const NetworkCanvas = forwardRef<CanvasHandle, {
  graph: TopologyBuffers | null; layout: LayoutResult | null; view: ViewConfig;
  filter: Filter; selected: number | null; path: number[]; allPaths: PathSet | null;
  onPick: (id: number | null) => void; onStats: (stats: FrameStats) => void; onError: (message: LocalizedText) => void;
}>(function NetworkCanvas(props, ref) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null), scene = useRef<NetworkScene | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const installedGraph = useRef<TopologyBuffers | null>(null);
  useEffect(() => {
    try {
      const renderer = new NetworkScene(host.current!, id => callbacks.current.onPick(id),
        stats => callbacks.current.onStats(stats), message => callbacks.current.onError(message));
      scene.current = renderer;
    } catch (error) {
      callbacks.current.onError(msg('Could not start the WebGL2 canvas: {error}', { error: errorText(error, 'Enable hardware acceleration') }));
    }
    return () => { scene.current?.dispose(); scene.current = null; installedGraph.current = null; };
  }, []);
  useEffect(() => {
    host.current?.querySelector('canvas')?.setAttribute('aria-label', t('Full Clos topology canvas'));
  }, [t]);
  useEffect(() => {
    if (!props.graph || !props.layout) { scene.current?.clear(); installedGraph.current = null; return; }
    if (installedGraph.current !== props.graph) {
      scene.current?.setGraph(props.graph, props.layout, props.view); installedGraph.current = props.graph;
    } else scene.current?.setLayout(props.layout, props.view.layout);
  }, [props.graph, props.layout]);
  useEffect(() => { scene.current?.setView(props.view); }, [props.view]);
  useEffect(() => { scene.current?.setFilter(props.filter); }, [props.filter, props.graph]);
  useEffect(() => { scene.current?.setSelection(props.selected, props.path, props.allPaths); }, [props.selected, props.path, props.allPaths, props.graph, props.layout]);
  useImperativeHandle(ref, () => ({
    reset: () => scene.current?.reset(),
    fit: () => scene.current?.reset(true),
    focus: id => scene.current?.focusNode(id),
    toggleRotate: () => scene.current?.toggleRotate() ?? false,
    benchmark: () => scene.current?.benchmark() ?? Promise.reject(new LocalizedError(msg("Canvas is not ready"))),
  }), []);
  return <div className="webgl-host" ref={host} data-testid="network-canvas" />;
});
