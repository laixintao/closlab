import { DEFAULT_VIEW, type SavedProject, type TopologySpec, type ViewConfig } from './types';
import { SpecError, validateSpec } from './engine';

export function serializeProject(spec: TopologySpec, view: ViewConfig): string {
  const project: SavedProject = { format: 'closlab', version: 1, spec, view };
  return JSON.stringify(project, null, 2);
}
export function parseProject(text: string): SavedProject {
  if (text.length > 65536) throw new Error('配置文件不能超过 64 KB');
  let project: SavedProject;
  try { project = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON'); }
  if (!project || project.format !== 'closlab' || project.version !== 1) throw new Error('请导入 ClosLab v1 配置文件');
  const errors = validateSpec(project.spec);
  if (errors.length) throw new SpecError(errors);
  const v = project.view ?? DEFAULT_VIEW;
  if (!['layered', 'planes', 'flat', 'radial'].includes(v.layout) ||
      !['straight', 'elbow'].includes(v.lines) || !['tier', 'plane'].includes(v.colorBy) ||
      typeof v.opacity !== 'number' || !Number.isFinite(v.opacity) || v.opacity < 0.01 || v.opacity > 0.8)
    throw new Error('可视化配置无效');
  if (v.showEndpoints !== undefined && typeof v.showEndpoints !== 'boolean') throw new Error('终端显示配置无效');
  // Legacy colorBy=tier links also use automatic plane colors now.
  return { format: 'closlab', version: 1, spec: project.spec,
    view: { ...v, colorBy: 'plane', showEndpoints: v.showEndpoints ?? true } };
}
