import { describe, expect, it } from 'vitest';
import { uniformSpec } from './defaults';
import { generate, shortestPath } from './engine';
import { allShortestPaths } from './paths';

describe('all equal-cost shortest paths', () => {
  it.each([1, 2, 15])('matches independently enumerated routes from E-0 to E-%i', target => {
    const graph = generate(uniformSpec(4, 3));
    const result = allShortestPaths(graph, 0, target);
    const hops = shortestPath(graph, 0, target).length - 1;
    const nodes = new Set<number>(), edges = new Set<number>();
    let count = 0n;
    const visit = (route: number[], links: number[]) => {
      const node = route.at(-1)!;
      if (node === target) {
        if (links.length === hops) {
          count++;
          route.forEach(n => nodes.add(n)); links.forEach(e => edges.add(e));
        }
        return;
      }
      if (links.length === hops) return;
      for (let i = graph.adjacencyOffsets[node]; i < graph.adjacencyOffsets[node + 1]; i++) {
        const edge = graph.incidentEdges[i], a = graph.edges[edge * 2], b = graph.edges[edge * 2 + 1];
        const next = a === node ? b : a;
        if (route.includes(next) || (next < graph.endpointCount && next !== target)) continue;
        visit([...route, next], [...links, edge]);
      }
    };
    visit([0], []);
    expect(result.distance).toBe(hops); expect(result.count).toBe(count);
    expect(new Set(result.nodes)).toEqual(nodes); expect(new Set(result.edges)).toEqual(edges);
    expect(result.edges.length).toBe(edges.size);
    const reverse = allShortestPaths(graph, target, 0);
    expect(reverse.count).toBe(count); expect(new Set(reverse.edges)).toEqual(edges);
  });

  it('includes all replicated fabric routes without forwarding through terminals', () => {
    const spec = uniformSpec(8, 2); spec.planes = 2;
    const graph = generate(spec);
    expect(allShortestPaths(graph, 0, graph.endpointCount - 1).count).toBe(8n);
    // Leaf switches in separate replicas have no path without using a terminal as transit.
    const from = graph.tierOffsets[0], to = from + 8;
    const disconnected = allShortestPaths(graph, from, to);
    expect(disconnected.count).toBe(0n); expect(disconnected.distance).toBe(-1);
    expect(disconnected.nodes.length).toBe(0); expect(disconnected.edges.length).toBe(0);
  });

  it('finds all 1,024 cross-Pod F16 routes and merges their shared links', () => {
    const spec = uniformSpec(128, 3);
    spec.tiers[0] = uniformSpec(32).tiers[0];
    spec.tiers[2].down = 64; spec.tiers[2].reserved = 64;
    spec.planes = 16; spec.planeStart = 1;
    const graph = generate(spec), from = graph.tierOffsets[0], to = from + 64;
    const result = allShortestPaths(graph, from, to);
    expect(result.count).toBe(1024n); expect(result.distance).toBe(4);
    expect(result.nodes.length).toBe(1058); expect(result.edges.length).toBe(2080);
    expect(new Set([...result.nodes].filter(n => graph.tier[n] === 2).map(n => graph.plane[n])).size).toBe(16);
    for (const n of result.nodes) if (graph.tier[n] === 1) expect([0, 1]).toContain(graph.pod[n]);
  });

  it('handles a single-node route and invalid endpoints', () => {
    const graph = generate(uniformSpec(4));
    const same = allShortestPaths(graph, 0, 0);
    expect(same.count).toBe(1n); expect(same.distance).toBe(0);
    expect([...same.nodes]).toEqual([0]); expect(same.edges.length).toBe(0);
    for (const target of [-1, graph.nodeCount, NaN, 0.5]) expect(allShortestPaths(graph, 0, target).count).toBe(0n);
  });
});
