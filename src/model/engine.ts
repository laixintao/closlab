import { LocalizedError, msg, type LocalizedText } from '../i18n/core';
import { RENDER_BUDGET, type CapacitySummary, type Diagnostic, type NodeInfo, type TopologyBuffers, type TopologySpec } from './types';
import { identifyColorGroups } from './colorGroups';

export class SpecError extends LocalizedError {
  diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map(d => d.message));
    this.name = 'SpecError';
    this.diagnostics = diagnostics;
  }
}
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const integer = (x: unknown, min: number, max: number): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= min && x <= max;
const positive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1e9;

/** Also validates untrusted JSON, before performing arithmetic or allocating buffers. */
export function validateSpec(value: unknown): Diagnostic[] {
  const errors: Diagnostic[] = [];
  const fail = (field: string, message: LocalizedText) => errors.push({ field, message });
  if (!value || typeof value !== 'object') return [{ field: 'spec', message: msg("Configuration must be an object") }];
  const s = value as TopologySpec;
  if (s.version !== 1) fail('version', msg("Unsupported configuration version"));
  if (!['capacity', 'endpoints', 'bandwidth'].includes(s.mode)) fail('mode', msg("Invalid calculation mode"));
  if (!Array.isArray(s.tiers) || s.tiers.length < 2 || s.tiers.length > 5)
    return [...errors, { field: 'tiers', message: msg("Switch tier count must be between 2 and 5") }];
  if (!integer(s.planes, 1, 64)) fail('planes', msg("Plane count must be an integer from 1 to 64"));
  if (!integer(s.planeStart, 0, s.tiers.length - 1)) fail('planeStart', msg("Plane split boundary is outside the switch tiers"));
  if (!integer(s.targetEndpoints, 1, Number.MAX_SAFE_INTEGER)) fail('targetEndpoints', msg("Target endpoint count must be a positive integer"));
  if (!positive(s.targetBandwidthTbps)) fail('targetBandwidthTbps', msg("Target injection bandwidth must be greater than 0"));
  s.tiers.forEach((p, i) => {
    const field = 'tiers.' + i;
    if (!p || typeof p !== 'object') { fail(field, msg('T{tier}: {error}', { tier: i, error: msg("Switch parameters are missing") })); return; }
    if (!integer(p.ports, 1, 4096)) fail(field + '.ports', msg('T{tier}: {error}', { tier: i, error: msg("Physical port count must be from 1 to 4096") }));
    if (!integer(p.breakout, 1, 64)) fail(field + '.breakout', msg('T{tier}: {error}', { tier: i, error: msg("Breakout must be from 1 to 64") }));
    if (!positive(p.portGbps) || !Number.isSafeInteger(Math.round(p.portGbps * 1000)) ||
        Math.abs(p.portGbps * 1000 - Math.round(p.portGbps * 1000)) > 1e-6)
      fail(field + '.portGbps', msg('T{tier}: {error}', { tier: i, error: msg("Logical port speed must be positive with 0.001 Gbps precision") }));
    if (!positive(p.chipTbps)) fail(field + '.chipTbps', msg('T{tier}: {error}', { tier: i, error: msg("ASIC bandwidth must be greater than 0") }));
    if (!integer(p.down, 1, 262144)) fail(field + '.down', msg('T{tier}: {error}', { tier: i, error: msg("Downlink count must be a positive integer") }));
    if (!integer(p.up, i === s.tiers.length - 1 ? 0 : 1, 262144))
      fail(field + '.up', msg('T{tier}: {error}', { tier: i, error: msg("Non-top tiers must retain at least one uplink") }));
    if (!integer(p.reserved, 0, 262144)) fail(field + '.reserved', msg('T{tier}: {error}', { tier: i, error: msg("Reserved port count must be a non-negative integer") }));
    if (i === s.tiers.length - 1 && p.up !== 0) fail(field + '.up', msg('T{tier}: {error}', { tier: i, error: msg("The top tier must have zero uplinks") }));
    if (p.down + p.up + p.reserved > p.ports * p.breakout)
      fail(field + '.down', msg('T{tier}: {error}', { tier: i, error: msg("Downlink, uplink, and reserved ports exceed effective ports") }));
    if ((p.down + p.up) * p.portGbps > p.chipTbps * 1000 + 1e-6)
      fail(field + '.chipTbps', msg('T{tier}: {error}', { tier: i, error: msg("Allocated port bandwidth exceeds one-way ASIC capacity") }));
    if (i && s.tiers[i - 1]?.portGbps !== p.portGbps)
      fail(field + '.portGbps', msg('T{tier}: {error}', { tier: i, error: msg("Logical link speeds must match across adjacent tiers") }));
  });
  if (integer(s.planeStart, 1, s.tiers.length - 1) && integer(s.planes, 1, 64)) {
    const uplinks = s.tiers[s.planeStart - 1]?.up;
    if (uplinks % s.planes !== 0)
      fail('planes', msg("Uplink count at the plane boundary must be divisible by the plane count"));
  }
  return errors;
}

/** Mixed-radix folded Clos. Counts use BigInt even when a graph cannot be rendered. */
export function calculate(spec: TopologySpec): CapacitySummary {
  const diagnostics = validateSpec(spec);
  if (diagnostics.length) throw new SpecError(diagnostics);
  const maxEndpoints = spec.tiers.reduce((n, p) => n * BigInt(p.down), 1n);
  const replicas = spec.planeStart === 0 ? spec.planes : 1;
  const endpointMbps = BigInt(Math.round(spec.tiers[0].portGbps * 1000)) * BigInt(replicas);
  const targetMbps = BigInt(Math.ceil(spec.targetBandwidthTbps * 1e6));
  const endpoints = spec.mode === 'capacity' ? maxEndpoints :
    spec.mode === 'endpoints' ? BigInt(spec.targetEndpoints) : ceilDiv(targetMbps, endpointMbps);
  if (endpoints > maxEndpoints) throw new SpecError([{
    field: spec.mode === 'endpoints' ? 'targetEndpoints' : 'targetBandwidthTbps',
    message: msg('Target exceeds the maximum capacity of {count} endpoints; adjust ports or add tiers', { count: maxEndpoints.toLocaleString('en-US') }),
  }]);
  const groups: bigint[] = [], widths: bigint[] = [], switches: bigint[] = [];
  let g = endpoints, width = 1n;
  for (let i = 0; i < spec.tiers.length; i++) {
    g = ceilDiv(g, BigInt(spec.tiers[i].down));
    if (i) width *= BigInt(spec.tiers[i - 1].up);
    groups.push(g); widths.push(width); switches.push(g * width * BigInt(replicas));
  }
  const links = [endpoints * BigInt(replicas),
    ...switches.slice(0, -1).map((n, i) => n * BigInt(spec.tiers[i].up))];
  const totalLinks = links.reduce((a, b) => a + b, 0n);
  const switchCount = switches.reduce((a, b) => a + b, 0n);
  const totalNodes = endpoints + switchCount;
  const warnings: LocalizedText[] = [];
  const canRender = totalNodes <= BigInt(RENDER_BUDGET.nodes) && totalLinks <= BigInt(RENDER_BUDGET.links);
  if (!canRender) warnings.push(msg("Capacity calculated. Full rendering supports 250,000 nodes / 5,000,000 links; reduce the scale with Target planning."));
  if (groups[0] * BigInt(spec.tiers[0].down) !== endpoints)
    warnings.push(msg("The final access group is partially filled; all switch uplink paths are preserved."));
  if (spec.tiers.slice(0, -1).some(p => p.down > p.up))
    warnings.push(msg("Some tiers are oversubscribed; total injection bandwidth is not end-to-end non-blocking bandwidth."));
  if (spec.planes > 1 && spec.planeStart > 0)
    warnings.push(msg("Switch-tier planes group uplink choices; changing the group count does not replicate devices when ports are fixed."));
  return {
    endpoints, maxEndpoints, endpointSlots: groups[0] * BigInt(spec.tiers[0].down),
    switches, switchCount, totalNodes, links, totalLinks, groups, widths, replicas,
    boundaryMbps: links.map((n, i) => n * BigInt(Math.round(spec.tiers[Math.max(0, i - 1)].portGbps * 1000))),
    endpointMbps, injectionMbps: endpoints * endpointMbps, canRender, warnings,
  };
}

export function generate(spec: TopologySpec, summary = calculate(spec)): TopologyBuffers {
  if (!summary.canRender) throw new LocalizedError(msg("Topology exceeds the full-rendering budget"));
  const endpointCount = Number(summary.endpoints), nodeCount = Number(summary.totalNodes);
  const edgeCount = Number(summary.totalLinks);
  const tier = new Int8Array(nodeCount).fill(-1);
  const plane = new Int16Array(nodeCount).fill(spec.planes === 1 ? 0 : -1);
  const pod = new Int32Array(nodeCount).fill(-1);
  const group = new Uint32Array(nodeCount), route = new Uint32Array(nodeCount);
  const edges = new Uint32Array(edgeCount * 2), tierOffsets = [endpointCount];
  for (const count of summary.switches) tierOffsets.push(tierOffsets.at(-1)! + Number(count));
  const groups = summary.groups.map(Number), widths = summary.widths.map(Number);
  for (let id = 0; id < endpointCount; id++) {
    group[id] = Math.floor(id / spec.tiers[0].down);
    pod[id] = spec.tiers.length === 2 ? group[id] : Math.floor(group[id] / spec.tiers[1].down);
  }
  for (let t = 0; t < spec.tiers.length; t++) {
    for (let r = 0; r < summary.replicas; r++) {
      for (let g = 0; g < groups[t]; g++) {
        for (let w = 0; w < widths[t]; w++) {
          const id = tierOffsets[t] + (r * groups[t] + g) * widths[t] + w;
          tier[id] = t; group[id] = g; route[id] = w;
          if (t === 0) pod[id] = spec.tiers.length === 2 ? g : Math.floor(g / spec.tiers[1].down);
          if (t === 1 && spec.tiers.length > 2) pod[id] = g;
          if (spec.planeStart === 0) plane[id] = r;
          else if (t >= spec.planeStart) {
            const b = spec.planeStart - 1;
            const choice = Math.floor(w / widths[b]) % spec.tiers[b].up;
            plane[id] = Math.floor(choice / (spec.tiers[b].up / spec.planes));
          }
        }
      }
    }
  }
  let e = 0;
  const connect = (a: number, b: number) => { edges[e++] = a; edges[e++] = b; };
  for (let r = 0; r < summary.replicas; r++)
    for (let n = 0; n < endpointCount; n++)
      connect(n, tierOffsets[0] + r * groups[0] + Math.floor(n / spec.tiers[0].down));
  for (let t = 0; t < spec.tiers.length - 1; t++) {
    for (let r = 0; r < summary.replicas; r++) {
      for (let g = 0; g < groups[t]; g++) {
        for (let w = 0; w < widths[t]; w++) {
          const from = tierOffsets[t] + (r * groups[t] + g) * widths[t] + w;
          // For T0 -> T1 this is the Pod: a ToR only reaches Fabric switches in
          // its own Pod. Plane membership partitions the routes above that Pod.
          const upperGroup = Math.floor(g / spec.tiers[t + 1].down);
          for (let u = 0; u < spec.tiers[t].up; u++) {
            const to = tierOffsets[t + 1] + (r * groups[t + 1] + upperGroup) * widths[t + 1] + w + u * widths[t];
            connect(from, to);
          }
        }
      }
    }
  }
  if (e !== edges.length) throw new LocalizedError(msg("Internal error: link count differs from capacity calculation"));
  const adjacencyOffsets = new Uint32Array(nodeCount + 1);
  for (const id of edges) adjacencyOffsets[id + 1]++;
  for (let i = 1; i <= nodeCount; i++) adjacencyOffsets[i] += adjacencyOffsets[i - 1];
  const cursors = adjacencyOffsets.slice(0, nodeCount), incidentEdges = new Uint32Array(edges.length);
  for (let i = 0; i < edgeCount; i++) {
    incidentEdges[cursors[edges[i * 2]]++] = i;
    incidentEdges[cursors[edges[i * 2 + 1]]++] = i;
  }
  const graph = { endpointCount, nodeCount, edgeCount, tierOffsets, tier, plane, pod, group, route, edges, adjacencyOffsets, incidentEdges };
  return { ...graph, ...identifyColorGroups(graph, spec) };
}

export function nodeLabel(graph: TopologyBuffers, id: number): string {
  if (id < 0 || id >= graph.nodeCount) return '—';
  return graph.tier[id] < 0 ? 'E-' + id : 'T' + graph.tier[id] + '-' + (id - graph.tierOffsets[graph.tier[id]]);
}
export function findNode(graph: TopologyBuffers, text: string): number | null {
  const match = /^(?:(E|T[0-4])-)?(\d+)$/i.exec(text.trim());
  if (!match) return null;
  const t = match[1]?.toUpperCase();
  const n = Number(match[2]);
  if (!Number.isSafeInteger(n)) return null;
  if (!t) return n < graph.nodeCount ? n : null;
  if (t === 'E') return n < graph.endpointCount ? n : null;
  const tier = Number(t.slice(1));
  if (tier >= graph.tierOffsets.length - 1) return null;
  const id = graph.tierOffsets[tier] + n;
  return id < graph.tierOffsets[tier + 1] ? id : null;
}
export function nodeInfo(graph: TopologyBuffers, spec: TopologySpec, id: number): NodeInfo {
  const usedPorts = graph.adjacencyOffsets[id + 1] - graph.adjacencyOffsets[id];
  const neighbors: number[] = [];
  for (let i = graph.adjacencyOffsets[id]; i < graph.adjacencyOffsets[id + 1]; i++) {
    const e = graph.incidentEdges[i] * 2;
    neighbors.push(graph.edges[e] === id ? graph.edges[e + 1] : graph.edges[e]);
  }
  const t = graph.tier[id], p = spec.tiers[t];
  return { index: id, label: nodeLabel(graph, id), tier: t, plane: graph.plane[id], pod: graph.pod[id],
    usedPorts, totalPorts: t < 0 ? (spec.planeStart === 0 ? spec.planes : 1) : p.ports * p.breakout,
    reservedPorts: t < 0 ? 0 : p.reserved, neighbors };
}

/** BFS never forwards through an endpoint. It returns one shortest valid physical path. */
export function shortestPath(graph: TopologyBuffers, source: number, target: number): number[] {
  if (![source, target].every(n => Number.isInteger(n) && n >= 0 && n < graph.nodeCount)) return [];
  if (source === target) return [source];
  const parent = new Int32Array(graph.nodeCount).fill(-1);
  const queue = new Uint32Array(graph.nodeCount);
  let head = 0, tail = 1; queue[0] = source; parent[source] = source;
  while (head < tail) {
    const n = queue[head++];
    for (let i = graph.adjacencyOffsets[n]; i < graph.adjacencyOffsets[n + 1]; i++) {
      const e = graph.incidentEdges[i] * 2;
      const next = graph.edges[e] === n ? graph.edges[e + 1] : graph.edges[e];
      if (parent[next] !== -1) continue;
      if (next < graph.endpointCount && next !== target) continue;
      parent[next] = n;
      if (next === target) {
        const result = [target];
        while (result.at(-1) !== source) result.push(parent[result.at(-1)!]);
        return result.reverse();
      }
      queue[tail++] = next;
    }
  }
  return [];
}
