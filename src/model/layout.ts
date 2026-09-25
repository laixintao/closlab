import type { CapacitySummary, LayoutMode, LayoutResult, TopologyBuffers, TopologySpec } from './types';

function grid(index: number, count: number, span: number): [number, number] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.4)));
  const rows = Math.ceil(count / cols);
  const step = span / Math.max(cols, rows, 2);
  return [(index % cols - (cols - 1) / 2) * step, (Math.floor(index / cols) - (rows - 1) / 2) * step];
}

/** A two-tier single fabric is one sheet, including its endpoint groups. */
function singlePlaneLayout(graph: TopologyBuffers, spec: TopologySpec, summary: CapacitySummary, mode: LayoutMode, span: number): LayoutResult {
  const positions = new Float32Array(graph.nodeCount * 3), gap = span * 0.32;
  const leaves = Number(summary.switches[0]), spines = Number(summary.switches[1]);
  const cols = Math.ceil(Math.sqrt(spec.tiers[0].down));
  const rows = Math.ceil(spec.tiers[0].down / cols);
  const pointStep = Math.max(0.8, span / 300);
  const leafStep = Math.max(4, (cols + 1) * pointStep);
  const width = Math.max(span * 0.65, (leaves - 1) * leafStep, (spines - 1) * 4);
  const at = (ordinal: number, count: number) => count === 1 ? 0 : (ordinal / (count - 1) - 0.5) * width;
  const point = (along: number, height: number): [number, number, number] => mode === 'flat' ? [along, height, 0] : [0, height, along];
  for (let n = 0; n < graph.nodeCount; n++) {
    const tier = graph.tier[n];
    let along: number, height: number;
    if (tier < 0) {
      const port = n % spec.tiers[0].down;
      along = at(graph.group[n], leaves) + (port % cols - (cols - 1) / 2) * pointStep;
      height = -Math.floor(port / cols) * pointStep;
    } else {
      const count = tier === 0 ? leaves : spines;
      along = at(n - graph.tierOffsets[tier], count); height = (tier + 1) * gap;
    }
    positions.set(point(along, height), n * 3);
  }
  const margin = Math.max(8, cols * pointStep), halfWidth = width / 2 + margin;
  const corners = [point(-halfWidth, -rows * pointStep - margin), point(-halfWidth, gap * 2 + margin),
    point(halfWidth, gap * 2 + margin), point(halfWidth, -rows * pointStep - margin)];
  const guides = new Float32Array(24);
  for (let i = 0; i < 4; i++) { guides.set(corners[i], i * 6); guides.set(corners[(i + 1) % 4], i * 6 + 3); }
  return { positions, span, height: gap * 2, guides, guideGroups: new Int32Array(8), labels: [
    { text: 'Plane P0', position: point(0, gap * 2 + margin), plane: 0, pod: null },
    { text: 'T1 · Spine', position: point(-halfWidth, gap * 2), plane: 0, pod: null },
    { text: 'T0 · Leaf', position: point(-halfWidth, gap), plane: 0, pod: null },
  ] };
}

/** All layouts preserve node IDs and the original edge list; no force simulation. */
export function layoutGraph(graph: TopologyBuffers, spec: TopologySpec, summary: CapacitySummary, mode: LayoutMode): LayoutResult {
  const positions = new Float32Array(graph.nodeCount * 3);
  const span = Math.max(180, Math.min(1200, Math.sqrt(graph.endpointCount) * 2.5));
  if (spec.planes === 1 && spec.tiers.length === 2 && mode !== 'radial')
    return singlePlaneLayout(graph, spec, summary, mode, span);
  let gap = span * 0.32;
  const baseLeaves = Number(summary.groups[0]);
  const leafStep = span / Math.max(2, Math.ceil(Math.sqrt(baseLeaves * 1.4)));
  const localCols = Math.ceil(Math.sqrt(spec.tiers[0].down));
  const localStep = leafStep * 0.72 / localCols;
  // Both 3D views keep a fabric on one geometric sheet. In particular, never
  // grid all replicas together: wrapping that grid scatters one plane over
  // several columns and makes independent fabrics look interleaved.
  const planeCount = graph.colorGroupCount, planeIds = graph.colorGroup;
  const separatePlanes = planeCount > 0 && (mode === 'planes' || mode === 'layered' || mode === 'flat');
  const planeStep = Math.max(8, span * (mode === 'planes' ? 0.5 : 0.36) * Math.min(1, 4 / planeCount));
  const switchStep = Math.max(4, span / 60);
  // In a three-tier fabric, each Pod is a transverse sheet: its ToR row below
  // the Fabric switches that sit at the intersections with the upper planes.
  const podSheets = separatePlanes && mode !== 'flat' && spec.tiers.length === 3 && planeIds[graph.tierOffsets[0]] < 0 &&
    planeIds[graph.tierOffsets[1]] >= 0;
  if (podSheets) gap = span * 0.56;
  const podCount = Number(summary.groups[1]);
  const fabricPerPod = podSheets ? Number(summary.widths[1]) / planeCount : 1;
  const podStep = Math.max(span * 0.15 * Math.min(1, 8 / podCount), fabricPerPod * switchStep * 2,
    podSheets ? (Number(summary.switches[2]) / planeCount - 1) * switchStep / Math.max(1, podCount - 1) : 0);
  const podZ = (pod: number) => (pod - (podCount - 1) / 2) * podStep;
  const leafRowWidth = Math.max((planeCount - 1) * planeStep, (spec.tiers[1].down - 1) * switchStep, span * 0.45);
  const leafX = (leaf: number) => ((leaf % spec.tiers[1].down) / Math.max(1, spec.tiers[1].down - 1) - 0.5) * leafRowWidth;
  const planeCounters = new Map<string, number>(), planeTotals = new Map<string, number>();
  if (separatePlanes) {
    for (let n = 0; n < graph.nodeCount; n++) {
      const key = graph.tier[n] + ':' + planeIds[n];
      planeTotals.set(key, (planeTotals.get(key) ?? 0) + 1);
    }
  }
  // In 2D, a whole fabric occupies its own horizontal interval. Stacking plane
  // rows vertically would send one fabric's links through every other fabric.
  const flatPlaneCenters: number[] = [];
  let flatWidth = 0;
  if (separatePlanes && mode === 'flat') {
    for (let plane = 0; plane < planeCount; plane++) {
      let widestRow = 1;
      for (let tier = 0; tier < spec.tiers.length; tier++) {
        widestRow = Math.max(widestRow, planeTotals.get(tier + ':' + plane) ?? 0);
      }
      const width = Math.max(span * 0.45, (widestRow - 1) * switchStep);
      flatPlaneCenters.push(flatWidth + width / 2);
      flatWidth += width + gap;
    }
    flatWidth -= gap;
    for (let plane = 0; plane < planeCount; plane++) flatPlaneCenters[plane] -= flatWidth / 2;
  }
  for (let n = 0; n < graph.nodeCount; n++) {
    const tier = graph.tier[n], level = tier + 1;
    const count = tier < 0 ? graph.endpointCount : Number(summary.switches[tier]);
    const local = tier < 0 ? n : n - graph.tierOffsets[tier];
    let x = 0, y = level * gap, z = 0;
    if (mode === 'flat' && separatePlanes && planeIds[n] >= 0) {
      const plane = planeIds[n], key = tier + ':' + plane;
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
    } else if (separatePlanes && planeIds[n] >= 0) {
      const p = planeIds[n], key = tier + ':' + p;
      const ordinal = planeCounters.get(key) ?? 0;
      planeCounters.set(key, ordinal + 1);
      // Each tier is a single unwrapped row. Its length grows with device count
      // rather than compressing nodes into a fixed-size box or adding rows.
      // X identifies the plane; Y contains its tiers and Z its devices.
      // Endpoints and shared lower tiers stay beneath the separate fabrics.
      x = (p - (planeCount - 1) / 2) * planeStep;
      z = (ordinal - (planeTotals.get(key)! - 1) / 2) * switchStep;
      if (podSheets) {
        if (tier === 1) z = podZ(graph.pod[n]) + (ordinal % fabricPerPod - (fabricPerPod - 1) / 2) * switchStep;
        else {
          const rowLength = Math.max((podCount - 1) * podStep, (planeTotals.get(key)! - 1) * switchStep, span * 0.45);
          z = planeTotals.get(key) === 1 ? 0 : (ordinal / (planeTotals.get(key)! - 1) - 0.5) * rowLength;
        }
      }
    } else if (podSheets) {
      const leaf = graph.group[n];
      x = leafX(leaf); z = podZ(graph.pod[n]);
      if (tier < 0) {
        const port = n % spec.tiers[0].down;
        const step = Math.min(leafRowWidth / Math.max(1, spec.tiers[1].down - 1), podStep) * 0.65 / localCols;
        x += (port % localCols - (localCols - 1) / 2) * step;
        z += (Math.floor(port / localCols) - (Math.ceil(spec.tiers[0].down / localCols) - 1) / 2) * step;
      }
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
    if (separatePlanes && mode !== 'flat' && planeIds[n] < 0 && !podSheets) {
      x *= Math.max(1, (planeCount - 1) * planeStep / span);
    }
    positions[n * 3] = x; positions[n * 3 + 1] = y; positions[n * 3 + 2] = z;
  }
  const guidePositions: number[] = [], guideGroups: number[] = [];
  const labels: LayoutResult['labels'] = [];
  const frame = (corners: number[][], group: number) => {
    for (let i = 0; i < 4; i++) {
      guidePositions.push(...corners[i], ...corners[(i + 1) % 4]);
      guideGroups.push(group, group);
    }
  };
  if (separatePlanes && mode !== 'flat' && spec.tiers.length >= 3) {
    const bounds = Array.from({ length: planeCount }, () => ({ x: 0, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }));
    for (let n = 0; n < graph.nodeCount; n++) {
      const p = planeIds[n]; if (p < 0) continue;
      const b = bounds[p], y = positions[n * 3 + 1], z = positions[n * 3 + 2];
      b.x = positions[n * 3]; b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
      b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
    }
    const margin = switchStep * 2;
    bounds.forEach((b, p) => {
      if (!Number.isFinite(b.minY)) return;
      frame([[b.x, b.minY - margin, b.minZ - margin], [b.x, b.maxY + margin, b.minZ - margin],
        [b.x, b.maxY + margin, b.maxZ + margin], [b.x, b.minY - margin, b.maxZ + margin]], p);
      if (p < 64) labels.push({ text: `Plane P${p}`, position: [b.x, b.maxY + margin, b.minZ - margin], plane: p, pod: null });
    });
    if (podSheets) for (let pod = 0; pod < podCount; pod++) {
      const z = podZ(pod), width = leafRowWidth / 2 + margin;
      frame([[-width, gap - margin, z], [-width, gap * 2 + margin, z],
        [width, gap * 2 + margin, z], [width, gap - margin, z]], -1);
      if (pod < 64) labels.push({ text: `Pod ${pod}`, position: [width, gap - margin, z], plane: null, pod });
    }
  }
  return { positions, span, height: spec.tiers.length * gap,
    guides: Float32Array.from(guidePositions), guideGroups: Int32Array.from(guideGroups), labels };
}
