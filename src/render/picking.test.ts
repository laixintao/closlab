import { describe, expect, it } from 'vitest';
import { nearestNode } from './picking';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
describe('nearest screen-space node selection', () => {
  it('selects the nearest node even when the click is well outside its body', () => {
    expect(nearestNode(new Float32Array([-.5, 0, 0, .5, 0, 0]), new Uint8Array([1, 1]), identity, 1000, 600, 640, 470)).toBe(1);
  });
  it('measures pixels rather than normalized coordinates on a wide canvas', () => {
    expect(nearestNode(new Float32Array([.2, 0, 0, 0, .3, 0]), new Uint8Array([1, 1]), identity, 1000, 200, 500, 100)).toBe(1);
  });
  it('ignores hidden and clipped nodes', () => {
    expect(nearestNode(new Float32Array([0, 0, 0, 1.1, 0, 0, .5, 0, 0, 0, 0, 2]), new Uint8Array([0, 1, 1, 1]), identity, 1000, 600, 500, 300)).toBe(2);
    expect(nearestNode(new Float32Array([0, 0, 0]), new Uint8Array([0]), identity, 1000, 600, 500, 300)).toBeNull();
  });
  it('uses perspective division and ignores nodes behind the camera', () => {
    const perspective = [...identity]; perspective[10] = 0; perspective[11] = -1; perspective[15] = 0;
    expect(nearestNode(new Float32Array([0, 0, 1, 2, 0, -4, .25, 0, -1]), new Uint8Array([1, 1, 1]), perspective, 1000, 600, 750, 300)).toBe(1);
  });
  it('prefers the front node when projected positions coincide', () => {
    expect(nearestNode(new Float32Array([0, 0, .5, 0, 0, -.5]), new Uint8Array([1, 1]), identity, 1000, 600, 500, 300)).toBe(1);
  });
});
