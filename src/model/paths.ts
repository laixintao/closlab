import type { PathSet, TopologyBuffers } from './types';

/** BFS counts shortest routes; walking their predecessor DAG collects every link once. */
export function allShortestPaths(graph: TopologyBuffers, source: number, target: number): PathSet {
  const empty: PathSet = { source, target, distance: -1, count: 0n, nodes: new Uint32Array(), edges: new Uint32Array() };
  if (![source, target].every(n => Number.isInteger(n) && n >= 0 && n < graph.nodeCount)) return empty;
  const distance = new Int32Array(graph.nodeCount).fill(-1);
  const counts = new Array<bigint>(graph.nodeCount).fill(0n);
  const queue = new Uint32Array(graph.nodeCount);
  let head = 0, tail = 1;
  queue[0] = source; distance[source] = 0; counts[source] = 1n;
  while (head < tail) {
    const node = queue[head++];
    if (distance[target] >= 0 && distance[node] >= distance[target]) break;
    for (let i = graph.adjacencyOffsets[node]; i < graph.adjacencyOffsets[node + 1]; i++) {
      const edge = graph.incidentEdges[i] * 2;
      const next = graph.edges[edge] === node ? graph.edges[edge + 1] : graph.edges[edge];
      // Terminals can be path endpoints, but never forward traffic between fabrics.
      if (next < graph.endpointCount && next !== target) continue;
      if (distance[next] === -1) {
        distance[next] = distance[node] + 1; queue[tail++] = next;
      }
      if (distance[next] === distance[node] + 1) counts[next] += counts[node];
    }
  }
  if (distance[target] < 0) return empty;
  const included = new Uint8Array(graph.nodeCount), edges: number[] = [];
  head = 0; tail = 1; queue[0] = target; included[target] = 1;
  while (head < tail) {
    const node = queue[head++];
    if (node === source) continue;
    for (let i = graph.adjacencyOffsets[node]; i < graph.adjacencyOffsets[node + 1]; i++) {
      const edge = graph.incidentEdges[i], offset = edge * 2;
      const previous = graph.edges[offset] === node ? graph.edges[offset + 1] : graph.edges[offset];
      if (distance[previous] !== distance[node] - 1) continue;
      edges.push(edge);
      if (!included[previous]) { included[previous] = 1; queue[tail++] = previous; }
    }
  }
  return { source, target, distance: distance[target], count: counts[target], nodes: queue.slice(0, tail), edges: Uint32Array.from(edges) };
}
