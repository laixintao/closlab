import { LocalizedError, msg } from '../i18n/core';
import { DEFAULT_VIEW, type SavedProject, type TopologySpec, type ViewConfig } from './types';
import { SpecError, validateSpec } from './engine';

export function serializeProject(spec: TopologySpec, view: ViewConfig): string {
  const project: SavedProject = { format: 'closlab', version: 1, spec, view };
  return JSON.stringify(project, null, 2);
}
export function parseProject(text: string): SavedProject {
  if (text.length > 65536) throw new LocalizedError(msg("Configuration files must not exceed 64 KB"));
  let project: SavedProject;
  try { project = JSON.parse(text); } catch { throw new LocalizedError(msg("File is not valid JSON")); }
  if (!project || project.format !== 'closlab' || project.version !== 1) throw new LocalizedError(msg("Import a ClosLab v1 configuration file"));
  const errors = validateSpec(project.spec);
  if (errors.length) throw new SpecError(errors);
  const v = project.view ?? DEFAULT_VIEW;
  if (!['layered', 'planes', 'flat', 'radial'].includes(v.layout) ||
      !['tier', 'plane'].includes(v.colorBy) ||
      typeof v.opacity !== 'number' || !Number.isFinite(v.opacity) || v.opacity < 0.01 || v.opacity > 1)
    throw new LocalizedError(msg("Invalid visualization configuration"));
  if (v.showEndpoints !== undefined && typeof v.showEndpoints !== 'boolean') throw new LocalizedError(msg("Invalid endpoint visibility setting"));
  // Ignore retired line-style settings and normalize legacy tier coloring.
  return { format: 'closlab', version: 1, spec: project.spec,
    view: { layout: v.layout, opacity: v.opacity, colorBy: 'plane', showEndpoints: v.showEndpoints ?? true } };
}
