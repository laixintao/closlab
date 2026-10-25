import type { CapacitySummary, LayoutResult, TopologyBuffers, TopologySpec } from './types';

/**
 * A wiring schematic, laid out independently of the 3D fabric sheets.
 * Spine blocks sit above side-by-side Pods. Fabric switches belong spatially
 * to their Pod, even though their uplinks belong to different spine planes.
 * Each physical device has exactly one position; edges and IDs are untouched.
 */
export function layout2D(graph: TopologyBuffers, spec: TopologySpec, summary: CapacitySummary): LayoutResult {
  const positions = new Float32Array(graph.nodeCount * 3);
  const guides: number[] = [], guideGroups: number[] = [], labels: LayoutResult['labels'] = [];
  const tiers = spec.tiers.length, replicas = summary.replicas;
  const step = 6, padding = 10, blockGap = 20;
  const endpointCols = Math.ceil(Math.sqrt(spec.tiers[0].down));
  const endpointStep = 1.2, endpointRows = Math.ceil(spec.tiers[0].down / endpointCols);
  const leafStep = Math.max(step * replicas, (endpointCols + 1) * endpointStep);
  const podCount = tiers > 2 ? Number(summary.groups[1]) : 1;
  const leavesPerPod = tiers > 2 ? spec.tiers[1].down : Number(summary.groups[0]);
  const leaves = Number(summary.groups[0]);
  const fabricsPerPod = tiers > 2 ? Number(summary.widths[1]) * replicas : 0;
  const pods: { left: number; width: number; firstLeaf: number; leafCount: number }[] = [];
  let width = 0;
  for (let pod = 0; pod < podCount; pod++) {
    const firstLeaf = pod * leavesPerPod, leafCount = Math.min(leavesPerPod, leaves - firstLeaf);
    const innerWidth = Math.max(36, leafCount * leafStep, fabricsPerPod * step);
    pods.push({ left: width, width: innerWidth + padding * 2, firstLeaf, leafCount });
    width += innerWidth + padding * 2 + blockGap;
  }
  width -= blockGap;

  // Only the upper block is organized by plane. In particular, do not pull a
  // Pod's Fabric switches apart to align them under their respective Spines.
  const upperStart = tiers > 2 ? 2 : 1;
  const upperRows = Array.from({ length: graph.colorGroupCount }, () =>
    Array.from({ length: tiers - upperStart }, () => [] as number[]));
  for (let n = graph.tierOffsets[upperStart]; n < graph.nodeCount; n++)
    upperRows[graph.colorGroup[n]][graph.tier[n] - upperStart].push(n);
  const blockWidths = upperRows.map(rows => Math.max(36, ...rows.map(row => row.length * step)) + padding * 2);
  const upperWidth = blockWidths.reduce((a, b) => a + b, 0) + blockGap * (blockWidths.length - 1);
  const totalWidth = Math.max(width, upperWidth);
  // Distribute the two rows across a common horizontal extent, without
  // stretching individual Pods or separating a Pod's local connections.
  const podExtraGap = podCount > 1 ? (totalWidth - width) / (podCount - 1) : 0;
  pods.forEach((pod, i) => { pod.left += i * podExtraGap - width / 2 - podExtraGap * (podCount - 1) / 2; });
  // Allocate the full upper row to Spine blocks, rather than leaving large
  // empty gaps between tiny groups when there are many more Pods than planes.
  const extraBlockWidth = (totalWidth - upperWidth) / blockWidths.length;
  blockWidths.forEach((_, i) => { blockWidths[i] += extraBlockWidth; });
  const largestPod = pods.reduce((max, pod) => Math.max(max, pod.width), 0);
  // A schematic needs a routing area proportional to its width. Fixed 3D
  // layer heights turn large 2D fabrics into an unreadable horizontal stripe.
  const gap = Math.max(65, Math.min(220, largestPod * 0.55), totalWidth * 0.12);
  const header = Math.max(padding, gap * 0.12);
  const y = (tier: number) => tier * gap + (tier >= upperStart ? gap * 0.45 : 0);
  const set = (node: number, x: number, height: number) => positions.set([x, height, 0], node * 3);
  const rowX = (left: number, rowWidth: number, ordinal: number, count: number) =>
    left + rowWidth / 2 + (count === 1 ? 0 : (ordinal / (count - 1) - 0.5) * (rowWidth - padding * 2));
  const frame = (left: number, right: number, bottom: number, top: number, group: number) => {
    const corners = [[left, bottom, 0], [left, top, 0], [right, top, 0], [right, bottom, 0]];
    for (let i = 0; i < 4; i++) {
      guides.push(...corners[i], ...corners[(i + 1) % 4]); guideGroups.push(group, group);
    }
  };
  const leafX = (leaf: number, replica: number | null) => {
    const pod = pods[Math.floor(leaf / leavesPerPod)];
    const center = pod.left + pod.width / 2 + (leaf - pod.firstLeaf - (pod.leafCount - 1) / 2) * leafStep;
    return center + (replica === null ? 0 : (replica - (replicas - 1) / 2) * step);
  };

  for (let n = 0; n < graph.endpointCount; n++) {
    const port = n % spec.tiers[0].down;
    set(n, leafX(graph.group[n], null) + (port % endpointCols - (endpointCols - 1) / 2) * endpointStep,
      -gap * 0.5 - Math.floor(port / endpointCols) * endpointStep);
  }
  for (let n = graph.tierOffsets[0]; n < graph.tierOffsets[1]; n++) {
    const replica = Math.floor((n - graph.tierOffsets[0]) / leaves);
    set(n, leafX(graph.group[n], replica), y(0));
  }
  if (tiers > 2) for (let n = graph.tierOffsets[1]; n < graph.tierOffsets[2]; n++) {
    const pod = pods[graph.pod[n]], perReplica = Number(summary.widths[1]);
    const replica = Math.floor((n - graph.tierOffsets[1]) / (podCount * perReplica));
    set(n, rowX(pod.left, pod.width, replica * perReplica + graph.route[n], fabricsPerPod), y(1));
  }

  // Labels sit in header strips above the device rows.
  // Keep all frames, but bound DOM annotations on very large networks.
  pods.forEach((pod, i) => {
    frame(pod.left, pod.left + pod.width, -header, y(upperStart - 1) + header * 2.5, tiers > 2 ? i : -1);
    if (i < 64) labels.push({ text: tiers > 2 ? `Pod ${i}` : 'Leaf · T0',
      position: [pod.left + pod.width / 2, y(upperStart - 1) + header * 1.3, 0], plane: null, pod: tiers > 2 ? i : null });
  });
  let cursor = -totalWidth / 2;
  upperRows.forEach((rows, plane) => {
    const blockWidth = blockWidths[plane];
    rows.forEach((nodes, index) => nodes.forEach((n, ordinal) => set(n, rowX(cursor, blockWidth, ordinal, nodes.length), y(index + upperStart))));
    frame(cursor, cursor + blockWidth, y(upperStart) - header, y(tiers - 1) + header * 2.5, plane);
    if (plane < 64) labels.push({ text: `Spine · P${plane}`, position: [cursor + blockWidth / 2, y(tiers - 1) + header * 1.3, 0], plane, pod: null });
    cursor += blockWidth + blockGap;
  });
  for (let tier = tiers - 1; tier >= 0; tier--) {
    const name = tier === 0 ? 'ToR' : tier === 1 && tiers > 2 ? 'Fabric' : 'Spine';
    labels.push({ text: `${name} · T${tier}`, position: [-totalWidth / 2 - Math.max(32, totalWidth * 0.065), y(tier), 0], plane: null, pod: null });
  }
  return { positions, span: Math.max(180, Math.min(1200, largestPod * 3)),
    height: y(tiers - 1) + gap * 0.5 + endpointRows * endpointStep,
    guides: Float32Array.from(guides), guideGroups: Int32Array.from(guideGroups), labels };
}
