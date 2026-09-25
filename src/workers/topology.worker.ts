/// <reference lib="webworker" />
import { errorText, LocalizedError, msg } from '../i18n/core';
import { calculate, generate, shortestPath } from '../model/engine';
import { layoutGraph } from '../model/layout';
import { allShortestPaths } from '../model/paths';
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
        [...transfer, layout.positions.buffer, layout.guides.buffer, layout.guideGroups.buffer] as ArrayBuffer[]);
    } else if (kind === 'layout') {
      if (!graph) throw new LocalizedError(msg("Generate a network first"));
      const result = layoutGraph(graph, spec, summary, payload.mode as LayoutMode);
      self.postMessage({ id, result }, [result.positions.buffer, result.guides.buffer, result.guideGroups.buffer]);
    } else if (kind === 'allPaths') {
      if (!graph) throw new LocalizedError(msg("Generate a network first"));
      const result = allShortestPaths(graph, payload.source, payload.target);
      self.postMessage({ id, result }, [result.nodes.buffer, result.edges.buffer]);
    } else if (kind === 'path') {
      if (!graph) throw new LocalizedError(msg("Generate a network first"));
      self.postMessage({ id, result: shortestPath(graph, payload.source, payload.target) });
    } else throw new LocalizedError(msg("Unknown computation task"));
  } catch (error) {
    self.postMessage({ id, error: errorText(error) });
  }
};
