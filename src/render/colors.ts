import type { TopologyBuffers, ViewConfig } from '../model/types';

export const TIER_COLORS = ['#63d9bb', '#64b8f7', '#aa96f7', '#f1b66c', '#f07eaf', '#e4db79'];
export const PLANE_COLORS = ['#19a7a0', '#9271c9', '#438fca', '#87ad51', '#d58a67', '#bd739c', '#59a6bf', '#b59b43'];
export const SHARED_COLOR = '#8c9aaa';
export const groupColor = (id: number): string => id < PLANE_COLORS.length
  ? PLANE_COLORS[id] : `hsl(${(id * 137.508) % 360}, 48%, 54%)`;
export const usesGroupColors = (graph: TopologyBuffers, _colorBy?: ViewConfig['colorBy']): boolean =>
  graph.colorGroupKind !== 'tier';
/** Fabric switches above shared ToRs belong to both a Pod and an upper plane. */
export const usesPodColors = (graph: TopologyBuffers): boolean =>
  graph.tierOffsets.length > 2 && graph.colorGroup[graph.tierOffsets[0]] < 0;
/** The upper endpoint colors each link: Fabric downlinks by Pod, Spine downlinks by plane. */
export function connectionColor(graph: TopologyBuffers, id: number, colorBy: ViewConfig['colorBy']): string {
  if (usesPodColors(graph) && graph.tier[id] === 1 && graph.pod[id] >= 0) return groupColor(graph.pod[id]);
  if (!usesGroupColors(graph, colorBy)) return TIER_COLORS[graph.tier[id] + 1];
  const group = graph.colorGroup[id];
  return group < 0 ? SHARED_COLOR : groupColor(group);
}
export function nodeColor(graph: TopologyBuffers, id: number, colorBy: ViewConfig['colorBy']): string {
  if (usesPodColors(graph) && graph.tier[id] >= 0 && graph.tier[id] <= 1 && graph.pod[id] >= 0) return groupColor(graph.pod[id]);
  return connectionColor(graph, id, colorBy);
}
