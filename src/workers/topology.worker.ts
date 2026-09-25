/// <reference lib="webworker" />
import { calculate, generate, shortestPath } from '../model/engine';
import { layoutGraph } from '../model/layout';
import type { CapacitySummary, LayoutMode, TopologyBuffers, TopologySpec } from '../model/types';

let graph: TopologyBuffers | null = null, spec: TopologySpec, summary: CapacitySummary;
self.onmessage = (event: MessageEvent) => {
  const { id, kind, payload } = event.data;
  try {
    if (kind === 'build') {
      const start = performance.now();
      spec = payload.spec;
      summary = calculate(spec);
      graph = null;
      if (!summary.canRender) {
        self.postMessage({ id, result: { spec, summary, graph: null, layout: null, elapsedMs: performance.now() - start } });
        return;
      }
      graph = generate(spec, summary);
      const layout = layoutGraph(graph, spec, summary, payload.layout);
      // Keep the graph for subsequent layouts/paths; transfer a compact rendering copy once.
      const copy = { ...graph,
        tier: graph.tier.slice(), plane: graph.plane.slice(), pod: graph.pod.slice(), colorGroup: graph.colorGroup.slice(),
        group: graph.group.slice(), route: graph.route.slice(), edges: graph.edges.slice(),
        adjacencyOffsets: graph.adjacencyOffsets.slice(), incidentEdges: graph.incidentEdges.slice() };
      const transfer = Object.values(copy).filter(ArrayBuffer.isView).map(a => (a as ArrayBufferView).buffer);
      self.postMessage({ id, result: { spec, summary, graph: copy, layout, elapsedMs: performance.now() - start } },
        [...transfer, layout.positions.buffer] as ArrayBuffer[]);
    } else if (kind === 'layout') {
      if (!graph) throw new Error('请先生成网络');
      const result = layoutGraph(graph, spec, summary, payload.mode as LayoutMode);
      self.postMessage({ id, result }, [result.positions.buffer]);
    } else if (kind === 'path') {
      if (!graph) throw new Error('请先生成网络');
      self.postMessage({ id, result: shortestPath(graph, payload.source, payload.target) });
    } else throw new Error('未知计算任务');
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : '计算失败' });
  }
};
