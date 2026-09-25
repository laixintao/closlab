export interface SwitchProfile {
  ports: number;
  breakout: number;
  portGbps: number;
  chipTbps: number;
  down: number;
  up: number;
  reserved: number;
}

export interface TopologySpec {
  version: 1;
  mode: 'capacity' | 'endpoints' | 'bandwidth';
  targetEndpoints: number;
  targetBandwidthTbps: number;
  planes: number;
  /** 0: independent fabrics sharing endpoints; i > 0: partition at tier i. */
  planeStart: number;
  tiers: SwitchProfile[];
}

export type LayoutMode = 'layered' | 'planes' | 'flat' | 'radial';
export type LineMode = 'straight' | 'elbow';
export interface ViewConfig {
  layout: LayoutMode;
  lines: LineMode;
  opacity: number;
  colorBy: 'tier' | 'plane';
}
export interface Filter {
  tier: number | null;
  plane: number | null;
  pod: number | null;
}
export const EMPTY_FILTER: Filter = { tier: null, plane: null, pod: null };
export const DEFAULT_VIEW: ViewConfig = { layout: 'layered', lines: 'straight', opacity: 0.18, colorBy: 'plane' };
export const RENDER_BUDGET = { nodes: 250_000, links: 5_000_000 };
export interface Diagnostic { field: string; message: string }
export interface CapacitySummary {
  endpoints: bigint;
  maxEndpoints: bigint;
  endpointSlots: bigint;
  switches: bigint[];
  switchCount: bigint;
  totalNodes: bigint;
  /** Endpoint boundary first, followed by inter-switch boundaries. */
  links: bigint[];
  totalLinks: bigint;
  boundaryMbps: bigint[];
  injectionMbps: bigint;
  endpointMbps: bigint;
  groups: bigint[];
  widths: bigint[];
  replicas: number;
  canRender: boolean;
  warnings: string[];
}
export interface ColorGrouping {
  /** Display-only groups; -1 denotes shared devices. Never changes physical plane membership. */
  colorGroup: Int32Array;
  colorGroupCount: number;
  colorGroupKind: 'tier' | 'plane' | 'connection';
}
export interface TopologyBuffers extends ColorGrouping {
  endpointCount: number;
  nodeCount: number;
  edgeCount: number;
  tierOffsets: number[];
  tier: Int8Array;
  plane: Int16Array;
  pod: Int32Array;
  group: Uint32Array;
  route: Uint32Array;
  /** Each pair is ordered lower tier -> upper tier; plane-colored links use the upper endpoint's plane. */
  edges: Uint32Array;
  adjacencyOffsets: Uint32Array;
  incidentEdges: Uint32Array;
}
export interface LayoutResult { positions: Float32Array; span: number; height: number }
export interface NodeInfo {
  index: number; label: string; tier: number; plane: number; pod: number;
  usedPorts: number; totalPorts: number; reservedPorts: number; neighbors: number[];
}
export interface SavedProject {
  format: 'closlab';
  version: 1;
  spec: TopologySpec;
  view: ViewConfig;
}
export interface BuildResult {
  spec: TopologySpec; summary: CapacitySummary; graph: TopologyBuffers;
  layout: LayoutResult; elapsedMs: number;
}
export interface FrameStats {
  fps: number; visibleNodes: number; visibleEdges: number;
  drawCalls: number; submittedSegments: number;
}
export interface BenchmarkResult {
  durationMs: number; medianFps: number; p95FrameMs: number; frames: number;
  nodes: number; links: number; submittedSegments: number; drawCalls: number;
  width: number; height: number; dpr: number; renderer: string;
  lineCompositing: 'depth' | 'blend';
}
