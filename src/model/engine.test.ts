import { describe, expect, it } from 'vitest';
import { uniformSpec } from './defaults';
import { calculate, findNode, generate, nodeInfo, shortestPath, validateSpec } from './engine';
import { layoutGraph } from './layout';
import { parseProject, serializeProject } from './project';
import { DEFAULT_VIEW, type TopologySpec } from './types';

const multi = (target?: number) => {
  const s = uniformSpec(64, 2, 100, 8);
  s.planes = 8;
  if (target) { s.mode = 'endpoints'; s.targetEndpoints = target; }
  return s;
};
function checkGraph(spec: TopologySpec) {
  const s = calculate(spec), g = generate(spec, s);
  expect(BigInt(g.nodeCount)).toBe(s.totalNodes);
  expect(BigInt(g.edgeCount)).toBe(s.totalLinks);
  const edgeCounts = new Array(spec.tiers.length).fill(0);
  const seen = new Set<string>();
  for (let e = 0; e < g.edgeCount; e++) {
    const a = g.edges[e * 2], b = g.edges[e * 2 + 1];
    expect(a).toBeLessThan(g.nodeCount); expect(b).toBeLessThan(g.nodeCount);
    expect(g.tier[b] - g.tier[a]).toBe(1);
    expect(seen.has(a + ':' + b)).toBe(false); seen.add(a + ':' + b);
    edgeCounts[g.tier[a] + 1]++;
    if (g.plane[a] >= 0 && g.plane[b] >= 0) expect(g.plane[a]).toBe(g.plane[b]);
  }
  expect(edgeCounts.map(BigInt)).toEqual(s.links);
  for (let n = 0; n < g.nodeCount; n++) {
    const info = nodeInfo(g, spec, n);
    expect(info.usedPorts + info.reservedPorts).toBeLessThanOrEqual(info.totalPorts);
    expect(findNode(g, info.label)).toBe(n);
    if (n >= g.endpointCount && g.tier[n] < spec.tiers.length - 1) {
      const up = info.neighbors.filter(id => g.tier[id] > g.tier[n]);
      expect(up.length).toBe(spec.tiers[g.tier[n]].up);
    }
  }
  for (const n of [0, Math.floor(g.endpointCount / 2), g.endpointCount - 1]) {
    const path = shortestPath(g, 0, n);
    expect(path.at(0)).toBe(0); expect(path.at(-1)).toBe(n);
    expect(path.slice(1, -1).every(id => id >= g.endpointCount)).toBe(true);
  }
  return g;
}
describe('Clos capacity reference values', () => {
  it('starts with 512 endpoints / 48 switches / 1024 links', () => {
    const s = calculate(uniformSpec());
    expect([s.endpoints, s.switchCount, s.totalLinks]).toEqual([512n, 48n, 1024n]);
    expect(s.injectionMbps).toBe(51200000n);
  });
  it('reproduces the conventional 64-port three-tier reference', () => {
    const s = calculate(uniformSpec(64, 3, 800));
    expect([s.endpoints, s.switchCount, s.totalLinks]).toEqual([65536n, 5120n, 196608n]);
    expect(s.switches).toEqual([2048n, 2048n, 1024n]);
  });
  it('reproduces the eight-plane full reference without counting terminals eight times', () => {
    const s = calculate(multi());
    expect([s.endpoints, s.switchCount, s.totalLinks]).toEqual([131072n, 6144n, 2097152n]);
    expect(s.endpointMbps).toBe(800000n);
  });
  it('fills a partial final group for 100,000 terminals', () => {
    const s = calculate(multi(100000));
    expect([s.endpoints, s.switchCount, s.totalLinks]).toEqual([100000n, 5176n, 1600768n]);
    expect(s.endpointSlots).toBe(100096n);
  });
  it('plans bandwidth in integer Mbps and rounds endpoints upward', () => {
    const s = multi(); s.mode = 'bandwidth'; s.targetBandwidthTbps = 80000.1;
    const result = calculate(s);
    expect(result.endpoints).toBe(100001n);
    expect(result.injectionMbps).toBeGreaterThanOrEqual(80000100000n);
  });
  it('covers F16 structural invariants using generic heterogeneous tier settings', () => {
    const s = uniformSpec(128, 3, 100);
    s.tiers[0] = uniformSpec(32).tiers[0];
    s.planes = 16; s.planeStart = 1;
    s.mode = 'endpoints'; s.targetEndpoints = 1024;
    const result = calculate(s);
    expect(s.tiers[0].up * s.tiers[0].portGbps).toBe(1600);
    expect(s.tiers[1].chipTbps).toBe(12.8);
    expect(result.switches).toEqual([64n, 16n, 1024n]);
    checkGraph(s);
  });
});
describe('graph invariants', () => {
  it.each([2, 3, 4, 5])('generates a valid %i-tier mixed-radix topology', t => {
    const s = uniformSpec(4, t); s.mode = 'endpoints'; s.targetEndpoints = 7;
    checkGraph(s);
  });
  it('preserves oversubscription, reserves and heterogeneous radix', () => {
    const s = uniformSpec(8, 3); s.tiers[0].down = 5; s.tiers[0].up = 2; s.tiers[0].reserved = 1;
    s.tiers[1].down = 3; s.tiers[1].up = 3; s.tiers[1].reserved = 2;
    checkGraph(s);
  });
  it('maintains isolation above arbitrary switch plane boundaries', () => {
    const s = uniformSpec(4, 4); s.planes = 2; s.planeStart = 2;
    checkGraph(s);
  });
  it('connects shared terminals to each independent plane', () => {
    const s = uniformSpec(4, 2); s.planes = 3;
    const g = checkGraph(s);
    expect(nodeInfo(g, s, 0).neighbors.map(n => g.plane[n])).toEqual([0, 1, 2]);
  });
  it('materializes every node and every edge of the full large-scale reference', () => {
    const spec = multi(), s = calculate(spec), g = generate(spec, s);
    expect(g.nodeCount).toBe(137216);
    expect(g.edges.length).toBe(4194304);
    expect(g.adjacencyOffsets[g.nodeCount]).toBe(g.edgeCount * 2);
    expect(shortestPath(g, 0, 131071)).toHaveLength(5);
    for (const t of [0, 1]) {
      for (let id = g.tierOffsets[t]; id < g.tierOffsets[t + 1]; id++)
        if (g.adjacencyOffsets[id + 1] - g.adjacencyOffsets[id] !== 512) throw new Error('port degree mismatch');
    }
  });
});
describe('validation, persistence and layouts', () => {
  it('accepts exact Mbps input despite binary floating point representation', () => {
    const s = uniformSpec(4, 2, 1.001);
    expect(validateSpec(s)).toEqual([]);
    expect(calculate(s).endpointMbps).toBe(1001n);
    s.tiers[0].portGbps = 1.0001;
    expect(validateSpec(s).some(e => e.field === 'tiers.0.portGbps')).toBe(true);
  });
  it('rejects invalid external data without allocating a graph', () => {
    for (const value of [null, {}, { tiers: [null, {}] }]) expect(validateSpec(value).length).toBeGreaterThan(0);
    const s = uniformSpec(); s.tiers[0].up = 33;
    expect(() => calculate(s)).toThrow('有效端口');
    s.tiers[0].up = 16; s.tiers[1].portGbps = 400;
    expect(() => calculate(s)).toThrow('速率必须一致');
    s.tiers[1].portGbps = 100; s.planes = 3; s.planeStart = 1;
    expect(() => calculate(s)).toThrow('整除');
  });
  it('rejects targets beyond capacity and preserves counts beyond safe integers', () => {
    const s = uniformSpec(); s.mode = 'endpoints'; s.targetEndpoints = 513;
    expect(() => calculate(s)).toThrow('最大容量');
    const huge = uniformSpec(4096, 5, 0.1, 64);
    const c = calculate(huge);
    expect(c.maxEndpoints).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(c.canRender).toBe(false);
    expect(() => generate(huge, c)).toThrow('预算');
  });
  it('round-trips JSON and validates view state', () => {
    const s = multi(100000);
    expect(parseProject(serializeProject(s, DEFAULT_VIEW)).spec).toEqual(s);
    expect(() => parseProject('{}')).toThrow();
    expect(() => parseProject(serializeProject(s, { ...DEFAULT_VIEW, opacity: NaN }))).toThrow();
  });
  it('produces finite deterministic positions in all four layouts', () => {
    const s = uniformSpec(8, 3), summary = calculate(s), graph = generate(s, summary);
    const original = graph.edges.slice();
    for (const mode of ['layered', 'planes', 'flat', 'radial'] as const) {
      const layout = layoutGraph(graph, s, summary, mode);
      expect(layout.positions.length).toBe(graph.nodeCount * 3);
      expect(layout.positions.every(Number.isFinite)).toBe(true);
      expect(graph.edges).toEqual(original);
      expect(layoutGraph(graph, s, summary, mode).positions).toEqual(layout.positions);
    }
  });
  it.each([0, 1, 2])('keeps each fabric on a distinct sheet with one row per tier above plane boundary %i', planeStart => {
    const s = uniformSpec(8, 3); s.planes = 4; s.planeStart = planeStart;
    const summary = calculate(s), graph = generate(s, summary), original = graph.edges.slice();
    for (const mode of ['layered', 'planes'] as const) {
      const { positions } = layoutGraph(graph, s, summary, mode);
      const planeX = new Map<number, number>();
      const rows = new Map<string, { y: number; z: number[] }>();
      let highestShared = -Infinity, lowestFabric = Infinity;
      const uniquePositions = new Set<string>();
      for (let n = 0; n < graph.nodeCount; n++) {
        const [x, y, z] = positions.subarray(n * 3, n * 3 + 3);
        uniquePositions.add(`${x}:${y}:${z}`);
        const plane = graph.plane[n];
        if (plane < 0) { highestShared = Math.max(highestShared, y); continue; }
        if (planeX.has(plane)) expect(x).toBe(planeX.get(plane));
        else planeX.set(plane, x);
        const key = plane + ':' + graph.tier[n], row = rows.get(key);
        if (row) { expect(y).toBe(row.y); row.z.push(z); }
        else rows.set(key, { y, z: [z] });
        lowestFabric = Math.min(lowestFabric, y);
      }
      expect(planeX.size).toBe(s.planes);
      expect(new Set(planeX.values()).size).toBe(s.planes);
      expect(highestShared).toBeLessThan(lowestFabric);
      expect(uniquePositions.size).toBe(graph.nodeCount);
      for (const row of rows.values()) {
        for (let i = 1; i < row.z.length; i++) expect(row.z[i] - row.z[i - 1]).toBeGreaterThanOrEqual(4);
      }
      expect(graph.edges).toEqual(original);
    }
  });
  it.each([0, 1, 2])('tiles 2D planes without overlap and keeps each tier in one row above boundary %i', planeStart => {
    const s = uniformSpec(16, 3); s.planes = 4; s.planeStart = planeStart;
    const summary = calculate(s), graph = generate(s, summary);
    const { positions } = layoutGraph(graph, s, summary, 'flat');
    const rows = new Map<string, { y: number; x: number[] }>();
    const planeBounds = new Map<number, { min: number; max: number }>();
    const tierRows = new Map<number, number>();
    let highestShared = -Infinity, lowestFabric = Infinity;
    for (let n = 0; n < graph.nodeCount; n++) {
      const [x, y, z] = positions.subarray(n * 3, n * 3 + 3);
      expect(z).toBe(0);
      if (graph.plane[n] < 0) { highestShared = Math.max(highestShared, y); continue; }
      lowestFabric = Math.min(lowestFabric, y);
      const plane = graph.plane[n], bounds = planeBounds.get(plane);
      if (bounds) { bounds.min = Math.min(bounds.min, x); bounds.max = Math.max(bounds.max, x); }
      else planeBounds.set(plane, { min: x, max: x });
      if (tierRows.has(graph.tier[n])) expect(y).toBe(tierRows.get(graph.tier[n]));
      else tierRows.set(graph.tier[n], y);
      const key = graph.tier[n] + ':' + graph.plane[n], row = rows.get(key);
      if (row) { expect(y).toBe(row.y); row.x.push(x); }
      else rows.set(key, { y, x: [x] });
    }
    expect(rows.size).toBe((s.tiers.length - planeStart) * s.planes);
    expect(new Set([...rows.values()].map(row => row.y)).size).toBe(s.tiers.length - planeStart);
    for (let plane = 1; plane < s.planes; plane++) {
      expect(planeBounds.get(plane)!.min).toBeGreaterThan(planeBounds.get(plane - 1)!.max);
    }
    expect(highestShared).toBeLessThan(lowestFabric);
    for (const row of rows.values()) {
      expect(row.x.length).toBeGreaterThan(1);
      // Coordinates are Float32; offsetting a row can round its spacing slightly.
      for (let i = 1; i < row.x.length; i++) expect(row.x[i] - row.x[i - 1]).toBeGreaterThan(3.999);
    }
  });
});
