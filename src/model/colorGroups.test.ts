import { describe, expect, it } from 'vitest';
import { uniformSpec } from './defaults';
import { generate, nodeInfo } from './engine';
import { identifyColorGroups } from './colorGroups';
import { connectionColor, groupColor, nodeColor, SHARED_COLOR, usesGroupColors, usesPodColors } from '../render/colors';

describe('colors follow actual upper-tier connectivity', () => {
  it('groups cross-Pod Spines with their shared Super-Spines, while Leaf stays shared', () => {
    const spec = uniformSpec(8, 3), graph = generate(spec);
    expect(graph.colorGroupKind).toBe('connection');
    expect(graph.colorGroupCount).toBe(4);
    expect(new Set(graph.plane)).toEqual(new Set([0]));
    const spine = graph.tierOffsets[1], top = graph.tierOffsets[2];
    expect(graph.colorGroup[spine]).toBe(graph.colorGroup[spine + 4]);
    expect(graph.pod[spine]).not.toBe(graph.pod[spine + 4]);
    expect(graph.colorGroup[spine]).not.toBe(graph.colorGroup[spine + 1]);
    for (let id = top; id < graph.nodeCount; id++) {
      const neighbors = nodeInfo(graph, spec, id).neighbors;
      expect(new Set(neighbors.map(n => graph.colorGroup[n]))).toEqual(new Set([graph.colorGroup[id]]));
      expect(connectionColor(graph, id, 'plane')).toBe(groupColor(graph.colorGroup[id]));
    }
    expect(nodeInfo(graph, spec, spine).neighbors.filter(n => graph.tier[n] === 2).length).toBe(4);
    for (let id = 0; id < spine; id++) {
      expect(graph.colorGroup[id]).toBe(-1);
      expect(nodeColor(graph, id, 'plane')).toBe(graph.tier[id] < 0 ? SHARED_COLOR : groupColor(graph.pod[id]));
    }
    expect(usesGroupColors(graph, 'plane')).toBe(true);
    expect(usesGroupColors(graph, 'tier')).toBe(true);
    expect(nodeColor(graph, spine, 'tier')).toBe(nodeColor(graph, spine, 'plane'));
  });

  it.each([1, 4])('colors lower Pod sheets consistently while preserving %i configured upper planes', planes => {
    const spec = uniformSpec(8, 3); spec.planes = planes; spec.planeStart = 1;
    const graph = generate(spec);
    expect(usesPodColors(graph)).toBe(true);
    const colorsByPod = new Map<number, Set<string>>();
    for (let id = graph.tierOffsets[0]; id < graph.tierOffsets[2]; id++) {
      const pod = graph.pod[id];
      if (!colorsByPod.has(pod)) colorsByPod.set(pod, new Set());
      colorsByPod.get(pod)!.add(nodeColor(graph, id, 'plane'));
      if (graph.tier[id] === 1) expect(connectionColor(graph, id, 'plane')).toBe(groupColor(pod));
    }
    for (const colors of colorsByPod.values()) expect(colors.size).toBe(1);
    expect(new Set([...colorsByPod.values()].flatMap(colors => [...colors])).size).toBe(colorsByPod.size);
    // Fabrics within one Pod share node and downlink colors, despite different upper planes.
    const a = graph.tierOffsets[1], b = a + 1;
    expect(nodeColor(graph, a, 'plane')).toBe(nodeColor(graph, b, 'plane'));
    expect(connectionColor(graph, a, 'plane')).toBe(connectionColor(graph, b, 'plane'));
    for (let e = 0; e < graph.edges.length; e += 2) {
      const lower = graph.edges[e], upper = graph.edges[e + 1];
      if (graph.tier[lower] === 0) {
        expect(connectionColor(graph, upper, 'plane')).toBe(nodeColor(graph, lower, 'plane'));
      } else if (graph.tier[lower] === 1) {
        expect(connectionColor(graph, upper, 'plane')).toBe(groupColor(graph.colorGroup[upper]));
      }
    }
    for (let id = graph.tierOffsets[2]; id < graph.nodeCount; id++)
      expect(nodeColor(graph, id, 'plane')).toBe(connectionColor(graph, id, 'plane'));
    // Pod numbering in replicated whole fabrics is local to each copy.
    spec.planes = 4; spec.planeStart = 0;
    expect(usesPodColors(generate(spec))).toBe(false);
  });

  it('leaves topology untouched and preserves explicit plane grouping', () => {
    const spec = uniformSpec(8, 3), implicit = generate(spec);
    spec.planes = 2; spec.planeStart = 1;
    const explicit = generate(spec);
    expect(explicit.edges).toEqual(implicit.edges);
    expect(explicit.colorGroupKind).toBe('plane');
    expect(explicit.colorGroupCount).toBe(2);
    expect([...explicit.colorGroup]).toEqual([...explicit.plane]);
    expect(nodeColor(explicit, explicit.tierOffsets[0], 'plane')).toBe(groupColor(0));
    spec.planeStart = 0;
    const replicas = generate(spec);
    expect([...replicas.colorGroup]).toEqual([...replicas.plane]);
  });

  it.each([3, 4, 5])('keeps groups consistent on every upper-tier link in a partial %i-tier network', tiers => {
    const spec = uniformSpec(4, tiers); spec.mode = 'endpoints'; spec.targetEndpoints = 7;
    const graph = generate(spec);
    expect(graph.colorGroupCount).toBe(2);
    for (let e = 0; e < graph.edges.length; e += 2) {
      const a = graph.edges[e], b = graph.edges[e + 1];
      if (graph.tier[a] >= 1) expect(graph.colorGroup[a]).toBe(graph.colorGroup[b]);
    }
    // Component discovery is independent of traversal order / physical edge order.
    const reordered = { ...graph, incidentEdges: graph.incidentEdges.slice() };
    for (let n = 0; n < graph.nodeCount; n++)
      reordered.incidentEdges.subarray(graph.adjacencyOffsets[n], graph.adjacencyOffsets[n + 1]).reverse();
    expect(identifyColorGroups(reordered, spec).colorGroup).toEqual(graph.colorGroup);
  });

  it('colors the two-tier default as one plane and avoids an eight-group color cycle', () => {
    const graph = generate(uniformSpec());
    expect(graph.colorGroupKind).toBe('plane');
    expect(graph.colorGroupCount).toBe(1);
    expect(new Set(graph.colorGroup)).toEqual(new Set([0]));
    expect(usesGroupColors(graph, 'plane')).toBe(true);
    expect(nodeColor(graph, graph.tierOffsets[0], 'plane')).toBe(groupColor(0));
    expect(new Set(Array.from({ length: 32 }, (_, id) => groupColor(id))).size).toBe(32);
  });
});
