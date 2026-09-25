import type { CapacitySummary, LayoutMode, LayoutResult, TopologyBuffers, TopologySpec } from './types';

function grid(index: number, count: number, span: number): [number, number] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.4)));
  const rows = Math.ceil(count / cols);
  const step = span / Math.max(cols, rows, 2);
  return [(index % cols - (cols - 1) / 2) * step, (Math.floor(index / cols) - (rows - 1) / 2) * step];
}

/** All layouts preserve node IDs and the original edge list; no force simulation. */
export function layoutGraph(graph: TopologyBuffers, spec: TopologySpec, summary: CapacitySummary, mode: LayoutMode): LayoutResult {
  const positions = new Float32Array(graph.nodeCount * 3);
  const span = Math.max(180, Math.min(1200, Math.sqrt(graph.endpointCount) * 2.5));
  const gap = span * 0.32;
  const baseLeaves = Number(summary.groups[0]);
  const leafStep = span / Math.max(2, Math.ceil(Math.sqrt(baseLeaves * 1.4)));
  const localCols = Math.ceil(Math.sqrt(spec.tiers[0].down));
  const localStep = leafStep * 0.72 / localCols;
  // Both 3D views keep a fabric on one geometric sheet. In particular, never
  // grid all replicas together: wrapping that grid scatters one plane over
  // several columns and makes independent fabrics look interleaved.
  const separatePlanes = spec.planes > 1 && (mode === 'planes' || mode === 'layered' || mode === 'flat');
  const planeStep = span * (mode === 'planes' ? 0.5 : 0.36);
  const switchStep = Math.max(4, span / 60);
  const planeCounters = new Map<string, number>(), planeTotals = new Map<string, number>();
  if (separatePlanes) {
    for (let n = 0; n < graph.nodeCount; n++) {
      const key = graph.tier[n] + ':' + graph.plane[n];
      planeTotals.set(key, (planeTotals.get(key) ?? 0) + 1);
    }
  }
  // In 2D, a whole fabric occupies its own horizontal interval. Stacking plane
  // rows vertically would send one fabric's links through every other fabric.
  const flatPlaneCenters: number[] = [];
  let flatWidth = 0;
  if (separatePlanes && mode === 'flat') {
    for (let plane = 0; plane < spec.planes; plane++) {
      let widestRow = 1;
      for (let tier = 0; tier < spec.tiers.length; tier++) {
        widestRow = Math.max(widestRow, planeTotals.get(tier + ':' + plane) ?? 0);
      }
      const width = Math.max(span * 0.45, (widestRow - 1) * switchStep);
      flatPlaneCenters.push(flatWidth + width / 2);
      flatWidth += width + gap;
    }
    flatWidth -= gap;
    for (let plane = 0; plane < spec.planes; plane++) flatPlaneCenters[plane] -= flatWidth / 2;
  }
  for (let n = 0; n < graph.nodeCount; n++) {
    const tier = graph.tier[n], level = tier + 1;
    const count = tier < 0 ? graph.endpointCount : Number(summary.switches[tier]);
    const local = tier < 0 ? n : n - graph.tierOffsets[tier];
    let x = 0, y = level * gap, z = 0;
    if (mode === 'flat' && separatePlanes && graph.plane[n] >= 0) {
      const plane = graph.plane[n], key = tier + ':' + plane;
      const ordinal = planeCounters.get(key) ?? 0;
      planeCounters.set(key, ordinal + 1);
      x = flatPlaneCenters[plane] + (ordinal - (planeTotals.get(key)! - 1) / 2) * switchStep;
    } else if (mode === 'flat') {
      const cols = Math.max(1, Math.ceil(Math.sqrt(count) * 4));
      const rows = Math.ceil(count / cols);
      x = ((local % cols) / Math.max(1, cols - 1) - 0.5) * Math.max(span, flatWidth);
      y += ((Math.floor(local / cols) + 0.5) / rows - 0.5) * gap * 0.48;
    } else if (mode === 'radial') {
      const rings = Math.max(1, Math.ceil(count / 600));
      const ring = local % rings, angle = Math.floor(local / rings) / Math.ceil(count / rings) * Math.PI * 2;
      const radius = span * (0.16 + (spec.tiers.length - level) * 0.19) + (ring / rings - 0.5) * span * 0.08;
      x = Math.cos(angle) * radius; y = Math.sin(angle) * radius;
    } else if (separatePlanes && graph.plane[n] >= 0) {
      const p = graph.plane[n], key = tier + ':' + p;
      const ordinal = planeCounters.get(key) ?? 0;
      planeCounters.set(key, ordinal + 1);
      // Each tier is a single unwrapped row. Its length grows with device count
      // rather than compressing nodes into a fixed-size box or adding rows.
      // X identifies the plane; Y contains its tiers and Z its devices.
      // Endpoints and shared lower tiers stay beneath the separate fabrics.
      x = (p - (spec.planes - 1) / 2) * planeStep;
      z = (ordinal - (planeTotals.get(key)! - 1) / 2) * switchStep;
    } else if (tier < 0) {
      const leaf = graph.group[n], port = n % spec.tiers[0].down;
      [x, z] = grid(leaf, baseLeaves, span);
      x += ((port % localCols) - (localCols - 1) / 2) * localStep;
      z += (Math.floor(port / localCols) - (Math.ceil(spec.tiers[0].down / localCols) - 1) / 2) * localStep;
    } else if (tier === 0) {
      [x, z] = grid(graph.group[n], baseLeaves, span);
      if (summary.replicas > 1) {
        const a = graph.plane[n] / summary.replicas * Math.PI * 2;
        x += Math.cos(a) * leafStep * 0.27;
        z += Math.sin(a) * leafStep * 0.27;
      }
    } else {
      [x, z] = grid(local, count, span * (1 - tier * 0.10));
    }
    if (separatePlanes && mode !== 'flat' && graph.plane[n] < 0) {
      x *= Math.max(1, (spec.planes - 1) * planeStep / span);
    }
    positions[n * 3] = x; positions[n * 3 + 1] = y; positions[n * 3 + 2] = z;
  }
  return { positions, span, height: spec.tiers.length * gap };
}
