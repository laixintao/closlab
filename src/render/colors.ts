import type { TopologyBuffers, ViewConfig } from '../model/types';

export const TIER_COLORS = ['#63d9bb', '#64b8f7', '#aa96f7', '#f1b66c', '#f07eaf', '#e4db79'];
export const PLANE_COLORS = ['#68dcca', '#b79bfa', '#f5bf79', '#72b9f5', '#f48ca8', '#b8df78', '#67d9ee', '#e3a4e6'];
export const SHARED_COLOR = '#839aaf';
export const groupColor = (id: number): string => id < PLANE_COLORS.length
  ? PLANE_COLORS[id] : `hsl(${(id * 137.508) % 360}, 65%, 70%)`;
export const usesGroupColors = (graph: TopologyBuffers, _colorBy?: ViewConfig['colorBy']): boolean =>
  graph.colorGroupKind !== 'tier';
/** Fabric switches above shared ToRs belong to both a Pod and an upper plane. */
export const usesPodColors = (graph: TopologyBuffers): boolean =>
  graph.tierOffsets.length > 2 && graph.colorGroup[graph.tierOffsets[0]] < 0;
/** Link endpoints retain plane membership independently of device display colors. */
export function connectionColor(graph: TopologyBuffers, id: number, colorBy: ViewConfig['colorBy']): string {
  if (!usesGroupColors(graph, colorBy)) return TIER_COLORS[graph.tier[id] + 1];
  const group = graph.colorGroup[id];
  return group < 0 ? SHARED_COLOR : groupColor(group);
}
export function nodeColor(graph: TopologyBuffers, id: number, colorBy: ViewConfig['colorBy']): string {
  if (usesPodColors(graph) && graph.tier[id] === 1 && graph.pod[id] >= 0) return groupColor(graph.pod[id]);
  return connectionColor(graph, id, colorBy);
}
