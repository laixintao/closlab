import { describe, expect, it } from 'vitest';
import { uniformSpec } from './defaults';
import { calculate, generate } from './engine';
import { layoutGraph } from './layout';
import type { TopologySpec } from './types';

function checkSchematic(spec: TopologySpec) {
  const summary = calculate(spec), graph = generate(spec, summary), edges = graph.edges.slice();
  const layout = layoutGraph(graph, spec, summary, 'flat'), p = layout.positions;
  const unique = new Set<string>(), heights = new Map<number, number>();
  let flat = true, finite = true, aligned = true, upwards = true;
  for (let n = 0; n < graph.nodeCount; n++) {
    const [x, y, z] = p.subarray(n * 3, n * 3 + 3);
    unique.add(`${x}:${y}:${z}`); flat &&= z === 0; finite &&= Number.isFinite(x + y + z);
    if (graph.tier[n] < 0) continue;
    const previous = heights.get(graph.tier[n]);
    aligned &&= previous === undefined || previous === y;
    heights.set(graph.tier[n], y);
  }
  for (let e = 0; e < graph.edgeCount; e++) upwards &&= p[graph.edges[e * 2] * 3 + 1] < p[graph.edges[e * 2 + 1] * 3 + 1];
  expect({ flat, finite, aligned, upwards }).toEqual({ flat: true, finite: true, aligned: true, upwards: true });
  expect(unique.size).toBe(graph.nodeCount);
  expect(graph.edges).toEqual(edges);
  expect(layoutGraph(graph, spec, summary, 'flat').positions).toEqual(p);
  // Each Pod box contains all of its ToRs and Fabric switches, across planes.
  const pods = spec.tiers.length > 2 ? Number(summary.groups[1]) : 1;
  for (let pod = 0; pod < pods; pod++) {
    const box = layout.guides.subarray(pod * 24, (pod + 1) * 24);
    const left = box[0], right = box[12];
    if (pod) expect(left).toBeGreaterThan(layout.guides[(pod - 1) * 24 + 12]);
    let contained = true;
    const end = graph.tierOffsets[spec.tiers.length > 2 ? 2 : 1];
    for (let n = graph.tierOffsets[0]; n < end; n++) {
      if (spec.tiers.length > 2 && graph.pod[n] !== pod) continue;
      contained &&= p[n * 3] > left && p[n * 3] < right && p[n * 3 + 1] > box[1] && p[n * 3 + 1] < box[7];
    }
    expect(contained).toBe(true);
  }
  return { graph, layout, summary };
}

describe('independent 2D Clos schematic', () => {
  it.each([2, 3, 4, 5])('draws %i tiers in rows, with real Pod boundaries and no duplicate devices', tiers => {
    const spec = uniformSpec(4, tiers);
    spec.mode = 'endpoints'; spec.targetEndpoints = tiers === 2 ? 7 : 13;
    checkSchematic(spec);
  });
  it.each([0, 1, 2])('retains shared devices and real wiring when the plane boundary is %i', planeStart => {
    const spec = uniformSpec(8, 3); spec.planes = 4; spec.planeStart = planeStart;
    const { graph, layout, summary } = checkSchematic(spec);
    const start = Number(summary.groups[1]) * 24;
    let contained = true;
    for (let n = graph.tierOffsets[2]; n < graph.nodeCount; n++) {
      const box = layout.guides.subarray(start + graph.colorGroup[n] * 24);
      contained &&= layout.positions[n * 3] > box[0] && layout.positions[n * 3] < box[12];
    }
    expect(contained).toBe(true);
  });
  it('orders Fabric switches by Pod, while Spine switches remain grouped by plane', () => {
    const spec = uniformSpec(8, 3), { graph, layout } = checkSchematic(spec);
    const x = (n: number) => layout.positions[n * 3];
    const firstFabric = graph.tierOffsets[1];
    expect([...graph.colorGroup.slice(firstFabric, firstFabric + 4)]).toEqual([0, 1, 2, 3]);
    expect(x(firstFabric + 3)).toBeLessThan(x(firstFabric + 4));
    // Every fabric plane occurs in every Pod, rather than each being a 3D sheet flattened into a 2D column.
    expect(new Set(Array.from({ length: 4 }, (_, i) => x(firstFabric + i))).size).toBe(4);
    expect(layout.labels.filter(label => label.pod !== null)).toHaveLength(8);
    expect(layout.labels.filter(label => label.text.startsWith('Spine · P'))).toHaveLength(4);
  });
  it('lays out every device of a 100,000-endpoint fabric, including a partial final Pod', () => {
    const spec = uniformSpec(64, 3); spec.tiers[2].ports = 128; spec.tiers[2].chipTbps = 12.8; spec.tiers[2].down = 128;
    spec.mode = 'endpoints'; spec.targetEndpoints = 100000;
    const { graph, summary } = checkSchematic(spec);
    expect(graph.endpointCount).toBe(100000);
    expect(graph.nodeCount).toBe(Number(summary.totalNodes));
  });
});
