import type { ColorGrouping, TopologyBuffers, TopologySpec } from './types';

type Connections = Pick<TopologyBuffers, 'nodeCount' | 'tier' | 'plane' | 'edges' | 'adjacencyOffsets' | 'incidentEdges'>;

/** Remove the shared Leaf layer, then identify actual connected components above it. */
export function identifyColorGroups(graph: Connections, spec: TopologySpec): ColorGrouping {
  if (spec.planes > 1) return {
    colorGroup: Int32Array.from(graph.plane), colorGroupCount: spec.planes, colorGroupKind: 'plane',
  };
  const colorGroup = new Int32Array(graph.nodeCount).fill(-1);
  if (spec.tiers.length < 3) return {
    colorGroup: new Int32Array(graph.nodeCount), colorGroupCount: 1, colorGroupKind: 'plane',
  };
  const queue = new Uint32Array(graph.nodeCount);
  let count = 0;
  for (let seed = 0; seed < graph.nodeCount; seed++) {
    if (graph.tier[seed] < 1 || colorGroup[seed] >= 0) continue;
    let head = 0, tail = 1;
    queue[0] = seed; colorGroup[seed] = count;
    while (head < tail) {
      const node = queue[head++];
      for (let i = graph.adjacencyOffsets[node]; i < graph.adjacencyOffsets[node + 1]; i++) {
        const edge = graph.incidentEdges[i] * 2;
        const next = graph.edges[edge] === node ? graph.edges[edge + 1] : graph.edges[edge];
        if (graph.tier[next] < 1 || colorGroup[next] >= 0) continue;
        colorGroup[next] = count; queue[tail++] = next;
      }
    }
    count++;
  }
  return { colorGroup, colorGroupCount: count, colorGroupKind: 'connection' };
}
