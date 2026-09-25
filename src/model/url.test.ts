import { describe, expect, it } from 'vitest';
import { uniformSpec } from './defaults';
import { DEFAULT_VIEW } from './types';
import { projectFromQuery, projectToQuery } from './url';

describe('shareable URL parameters', () => {
  it('round-trips a target network with heterogeneous tiers and its view', () => {
    const spec = uniformSpec(32, 3); spec.mode = 'endpoints'; spec.targetEndpoints = 100;
    spec.planes = 8; spec.planeStart = 1;
    spec.tiers[1] = { ...spec.tiers[1], ports: 64, chipTbps: 6.4, down: 32, up: 32 };
    const view = { ...DEFAULT_VIEW, layout: 'flat' as const, lines: 'elbow' as const, colorBy: 'plane' as const, opacity: .35 };
    expect(projectFromQuery(projectToQuery(spec, view))).toEqual({ format: 'closlab', version: 1, spec, view });
  });
  it('builds shared hardware and balanced ports from short editable parameters', () => {
    const result = projectFromQuery('?ports=64&breakout=8&chipTbps=51.2&planes=8&layout=planes')!;
    expect(result.spec).toEqual({ ...uniformSpec(64, 2, 100, 8), planes: 8 });
    expect(result.view.layout).toBe('planes');
  });
  it('retains all five tiers and fractional Mbps port rates', () => {
    const spec = uniformSpec(8, 5, 1.001);
    expect(projectFromQuery(projectToQuery(spec, DEFAULT_VIEW))!.spec).toEqual(spec);
  });
  it('does not treat unrelated query parameters as a network configuration', () => {
    expect(projectFromQuery('?utm_source=demo')).toBeNull();
  });
  it.each(['?v=2', '?tiers=100000', '?planes=NaN', '?planes=2&planes=3', '?tiers=2&t4.down=2',
    '?layout=invalid', '?opacity=5', '?ports=0', '?t0.down=100', '?mode=endpoints&endpoints=1000000'])('rejects invalid query %s', query => {
    expect(() => projectFromQuery(query)).toThrow();
  });
});
