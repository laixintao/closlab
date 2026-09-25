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
  onPick: (id: number | null) => void; onStats: (stats: FrameStats) => void; onError: (message: string) => void;
}>(function NetworkCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<NetworkScene | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const installedGraph = useRef<TopologyBuffers | null>(null);
  useEffect(() => {
    try {
      const renderer = new NetworkScene(host.current!, id => callbacks.current.onPick(id),
        stats => callbacks.current.onStats(stats), message => callbacks.current.onError(message));
      scene.current = renderer;
    } catch (error) {
      callbacks.current.onError('无法启动 WebGL2 画布：' + (error instanceof Error ? error.message : '请启用硬件加速'));
    }
    return () => { scene.current?.dispose(); scene.current = null; installedGraph.current = null; };
  }, []);
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
    benchmark: () => scene.current?.benchmark() ?? Promise.reject(new Error('画布尚未就绪')),
  }), []);
  return <div className="webgl-host" ref={host} data-testid="network-canvas" />;
});
