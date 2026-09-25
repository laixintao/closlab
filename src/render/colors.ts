import type { TopologyBuffers, ViewConfig } from '../model/types';

export const TIER_COLORS = ['#63d9bb', '#64b8f7', '#aa96f7', '#f1b66c', '#f07eaf', '#e4db79'];
export const PLANE_COLORS = ['#68dcca', '#b79bfa', '#f5bf79', '#72b9f5', '#f48ca8', '#b8df78', '#67d9ee', '#e3a4e6'];
export const SHARED_COLOR = '#839aaf';
export const groupColor = (id: number): string => id < PLANE_COLORS.length
  ? PLANE_COLORS[id] : `hsl(${(id * 137.508) % 360}, 65%, 70%)`;
export const usesGroupColors = (graph: TopologyBuffers, colorBy: ViewConfig['colorBy']): boolean =>
  colorBy === 'plane' && graph.colorGroupKind !== 'tier';
export function nodeColor(graph: TopologyBuffers, id: number, colorBy: ViewConfig['colorBy']): string {
  if (!usesGroupColors(graph, colorBy)) return TIER_COLORS[graph.tier[id] + 1];
  const group = graph.colorGroup[id];
  return group < 0 ? SHARED_COLOR : groupColor(group);
}
