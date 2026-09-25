import { describe, expect, it } from 'vitest';
import { uniformSpec } from './defaults';
import { generate, nodeInfo } from './engine';
import { identifyColorGroups } from './colorGroups';
import { groupColor, nodeColor, SHARED_COLOR, TIER_COLORS, usesGroupColors } from '../render/colors';

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
      for (const n of neighbors) expect(nodeColor(graph, n, 'plane')).toBe(nodeColor(graph, id, 'plane'));
    }
    expect(nodeInfo(graph, spec, spine).neighbors.filter(n => graph.tier[n] === 2).length).toBe(4);
    for (let id = 0; id < spine; id++) {
      expect(graph.colorGroup[id]).toBe(-1);
      expect(nodeColor(graph, id, 'plane')).toBe(SHARED_COLOR);
    }
    expect(usesGroupColors(graph, 'plane')).toBe(true);
    expect(usesGroupColors(graph, 'tier')).toBe(false);
    expect(nodeColor(graph, spine, 'tier')).toBe(TIER_COLORS[2]);
  });

  it('leaves topology untouched and preserves explicit plane grouping', () => {
    const spec = uniformSpec(8, 3), implicit = generate(spec);
    spec.planes = 2; spec.planeStart = 1;
    const explicit = generate(spec);
    expect(explicit.edges).toEqual(implicit.edges);
    expect(explicit.colorGroupKind).toBe('plane');
    expect(explicit.colorGroupCount).toBe(2);
    expect([...explicit.colorGroup]).toEqual([...explicit.plane]);
    expect(nodeColor(explicit, explicit.tierOffsets[0], 'plane')).toBe(SHARED_COLOR);
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

  it('keeps the simple two-tier default colored by tier and avoids an eight-group color cycle', () => {
    const graph = generate(uniformSpec());
    expect(graph.colorGroupKind).toBe('tier');
    expect(usesGroupColors(graph, 'plane')).toBe(false);
    expect(nodeColor(graph, graph.tierOffsets[0], 'plane')).toBe(TIER_COLORS[1]);
    expect(new Set(Array.from({ length: 32 }, (_, id) => groupColor(id))).size).toBe(32);
  });
});
