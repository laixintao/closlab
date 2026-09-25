import { LocalizedError, msg } from '../i18n/core';
import { uniformSpec } from './defaults';
import { calculate } from './engine';
import { parseProject, serializeProject } from './project';
import { DEFAULT_VIEW, type SavedProject, type SwitchProfile, type TopologySpec, type ViewConfig } from './types';

const hardware = ['ports', 'breakout', 'chipTbps', 'portGbps'] as const;
const allocation = ['down', 'up', 'reserved'] as const;
const keys = new Set(['v', 'mode', 'endpoints', 'bandwidth', 'planes', 'planeStart', 'tiers', ...hardware,
  'layout', 'lines', 'colorBy', 'opacity', 'showEndpoints']);
const isProjectKey = (key: string) => keys.has(key) || /^t\d+\./.test(key);

/** A self-contained, editable query string. Never serialize an unapplied draft. */
export function projectToQuery(spec: TopologySpec, view: ViewConfig): string {
  const params = new URLSearchParams({ v: '1', mode: spec.mode, endpoints: String(spec.targetEndpoints),
    bandwidth: String(spec.targetBandwidthTbps), planes: String(spec.planes), planeStart: String(spec.planeStart), tiers: String(spec.tiers.length) });
  for (const key of hardware) params.set(key, String(spec.tiers[0][key]));
  spec.tiers.forEach((profile, tier) => {
    for (const key of [...hardware, ...allocation]) {
      if (hardware.includes(key as typeof hardware[number]) && profile[key] === spec.tiers[0][key]) continue;
      params.set(`t${tier}.${key}`, String(profile[key]));
    }
  });
  for (const [key, value] of Object.entries(view)) params.set(key, String(value));
  return params.toString();
}

/** Missing fields use model defaults; URL parameters always take priority over browser storage. */
export function projectFromQuery(search: string): SavedProject | null {
  if (search.length > 8192) throw new LocalizedError(msg("Share-link parameters are too long"));
  const params = new URLSearchParams(search);
  if (![...params.keys()].some(isProjectKey)) return null;
  for (const key of params.keys()) {
    if (isProjectKey(key) && params.getAll(key).length !== 1) throw new LocalizedError(msg("Duplicate parameter: {key}", { key }));
  }
  const number = (key: string, fallback: number): number => {
    if (!params.has(key)) return fallback;
    const value = params.get(key)!;
    if (!value.trim() || !Number.isFinite(Number(value))) throw new LocalizedError(msg("Parameter {key} must be numeric", { key }));
    return Number(value);
  };
  if (number('v', 1) !== 1) throw new LocalizedError(msg("Unsupported share-link version"));
  const count = number('tiers', 2);
  if (!Number.isInteger(count) || count < 2 || count > 5) throw new LocalizedError(msg("Switch tier count must be between 2 and 5"));
  const ports = number('ports', 32), breakout = number('breakout', 1);
  const chipTbps = number('chipTbps', ports * breakout * 100 / 1000);
  const portGbps = number('portGbps', Math.floor(chipTbps * 1000 / (ports * breakout) * 1000 + 1e-6) / 1000);
  const spec = uniformSpec(ports, count, portGbps, breakout);
  spec.mode = (params.get('mode') ?? spec.mode) as TopologySpec['mode'];
  spec.targetEndpoints = number('endpoints', spec.targetEndpoints);
  spec.targetBandwidthTbps = number('bandwidth', spec.targetBandwidthTbps);
  spec.planes = number('planes', 1); spec.planeStart = number('planeStart', 0);
  for (const profile of spec.tiers) profile.chipTbps = chipTbps;
  for (const [key] of params) {
    if (!/^t\d+\./.test(key)) continue;
    const match = /^t(\d+)\.(ports|breakout|chipTbps|portGbps|down|up|reserved)$/.exec(key);
    if (!match || Number(match[1]) >= count) throw new LocalizedError(msg("Unknown switch-tier parameter: {key}", { key }));
    const tier = Number(match[1]), field = match[2] as keyof SwitchProfile;
    spec.tiers[tier][field] = number(key, spec.tiers[tier][field]);
  }
  const view: ViewConfig = {
    layout: (params.get('layout') ?? DEFAULT_VIEW.layout) as ViewConfig['layout'],
    lines: (params.get('lines') ?? DEFAULT_VIEW.lines) as ViewConfig['lines'],
    colorBy: (params.get('colorBy') ?? DEFAULT_VIEW.colorBy) as ViewConfig['colorBy'],
    opacity: number('opacity', DEFAULT_VIEW.opacity),
    showEndpoints: params.get('showEndpoints') === 'false' ? false : true,
  };
  if (params.has('showEndpoints') && !['true', 'false'].includes(params.get('showEndpoints')!))
    throw new LocalizedError(msg("showEndpoints must be true or false"));
  const project = parseProject(serializeProject(spec, view));
  calculate(project.spec);
  return project;
}
