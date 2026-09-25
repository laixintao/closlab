import type { SwitchProfile, TopologySpec } from './types';

export function profile(ports = 32, portGbps = 100, breakout = 1): SwitchProfile {
  const logical = ports * breakout;
  return { ports, breakout, portGbps, chipTbps: logical * portGbps / 1000,
    down: Math.ceil(logical / 2), up: Math.floor(logical / 2), reserved: 0 };
}
export function uniformSpec(ports = 32, count = 2, portGbps = 100, breakout = 1): TopologySpec {
  return {
    version: 1, mode: 'capacity', targetEndpoints: 100000, targetBandwidthTbps: 80000,
    planes: 1, planeStart: 0,
    tiers: Array.from({ length: count }, (_, i) => ({
      ...profile(ports, portGbps, breakout),
      ...(i === count - 1 ? { down: ports * breakout, up: 0 } : {}),
    })),
  };
}
export const DEFAULT_SPEC = uniformSpec();
