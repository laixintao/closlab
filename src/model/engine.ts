import { RENDER_BUDGET, type CapacitySummary, type Diagnostic, type NodeInfo, type TopologyBuffers, type TopologySpec } from './types';
import { identifyColorGroups } from './colorGroups';

export class SpecError extends Error {
  diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map(d => d.message).join('；'));
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
  const fail = (field: string, message: string) => errors.push({ field, message });
  if (!value || typeof value !== 'object') return [{ field: 'spec', message: '配置必须是一个对象' }];
  const s = value as TopologySpec;
  if (s.version !== 1) fail('version', '不支持此配置版本');
  if (!['capacity', 'endpoints', 'bandwidth'].includes(s.mode)) fail('mode', '计算方式无效');
  if (!Array.isArray(s.tiers) || s.tiers.length < 2 || s.tiers.length > 5)
    return [...errors, { field: 'tiers', message: '交换机层数必须为 2–5 层' }];
  if (!integer(s.planes, 1, 64)) fail('planes', '平面数必须为 1–64 的整数');
  if (!integer(s.planeStart, 0, s.tiers.length - 1)) fail('planeStart', '分平面起点超出交换机层级');
  if (!integer(s.targetEndpoints, 1, Number.MAX_SAFE_INTEGER)) fail('targetEndpoints', '目标终端数必须为正整数');
  if (!positive(s.targetBandwidthTbps)) fail('targetBandwidthTbps', '目标总注入带宽必须大于 0');
  s.tiers.forEach((p, i) => {
    const field = 'tiers.' + i;
    const label = 'T' + i + '：';
    if (!p || typeof p !== 'object') { fail(field, label + '交换机参数缺失'); return; }
    if (!integer(p.ports, 1, 4096)) fail(field + '.ports', label + '物理端口数必须为 1–4096');
    if (!integer(p.breakout, 1, 64)) fail(field + '.breakout', label + '拆分数必须为 1–64');
    if (!positive(p.portGbps) || !Number.isSafeInteger(Math.round(p.portGbps * 1000)) ||
        Math.abs(p.portGbps * 1000 - Math.round(p.portGbps * 1000)) > 1e-6)
      fail(field + '.portGbps', label + '逻辑端口速率必须为正数，精确到 0.001 Gbps');
    if (!positive(p.chipTbps)) fail(field + '.chipTbps', label + '芯片带宽必须大于 0');
    if (!integer(p.down, 1, 262144)) fail(field + '.down', label + '下行端口必须为正整数');
    if (!integer(p.up, i === s.tiers.length - 1 ? 0 : 1, 262144))
      fail(field + '.up', label + '非顶层必须至少保留一个上行端口');
    if (!integer(p.reserved, 0, 262144)) fail(field + '.reserved', label + '预留端口必须为非负整数');
    if (i === s.tiers.length - 1 && p.up !== 0) fail(field + '.up', label + '顶层上行端口必须为 0');
    if (p.down + p.up + p.reserved > p.ports * p.breakout)
      fail(field + '.down', label + '上下行与预留端口之和超过有效端口数');
    if ((p.down + p.up) * p.portGbps > p.chipTbps * 1000 + 1e-6)
      fail(field + '.chipTbps', label + '已分配端口带宽超过芯片单向交换容量');
    if (i && s.tiers[i - 1]?.portGbps !== p.portGbps)
      fail(field + '.portGbps', label + '相邻层的逻辑链路速率必须一致');
  });
  if (integer(s.planeStart, 1, s.tiers.length - 1) && integer(s.planes, 1, 64)) {
    const uplinks = s.tiers[s.planeStart - 1]?.up;
    if (uplinks % s.planes !== 0)
      fail('planes', '分平面边界的上行端口数必须能被平面数整除');
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
    message: '目标超过该拓扑的最大容量 ' + maxEndpoints.toLocaleString() + ' 个终端，请调整端口分配或增加 tier',
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
  const warnings: string[] = [];
  const canRender = totalNodes <= BigInt(RENDER_BUDGET.nodes) && totalLinks <= BigInt(RENDER_BUDGET.links);
  if (!canRender) warnings.push('已完成容量计算。全量渲染上限为 25 万总节点 / 500 万条链路；请用目标规划缩小规模。');
  if (groups[0] * BigInt(spec.tiers[0].down) !== endpoints)
    warnings.push('最后一个接入组未满配；交换机上行路径保持完整。');
  if (spec.tiers.slice(0, -1).some(p => p.down > p.up))
    warnings.push('部分层存在带宽收敛，终端总注入带宽不代表端到端无阻塞带宽。');
  if (spec.planes > 1 && spec.planeStart > 0)
    warnings.push('交换层分平面按上行选择维度分组；固定端口配置时，改变分组数量不额外复制设备。');
  return {
    endpoints, maxEndpoints, endpointSlots: groups[0] * BigInt(spec.tiers[0].down),
    switches, switchCount, totalNodes, links, totalLinks, groups, widths, replicas,
    boundaryMbps: links.map((n, i) => n * BigInt(Math.round(spec.tiers[Math.max(0, i - 1)].portGbps * 1000))),
    endpointMbps, injectionMbps: endpoints * endpointMbps, canRender, warnings,
  };
}

export function generate(spec: TopologySpec, summary = calculate(spec)): TopologyBuffers {
  if (!summary.canRender) throw new Error('拓扑超过全量渲染预算');
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
  if (e !== edges.length) throw new Error('内部错误：链路数量与容量计算不一致');
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
