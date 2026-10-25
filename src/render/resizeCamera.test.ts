import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { resizeCamera } from './resizeCamera';

describe('camera viewport resizing', () => {
  it.each(['orthographic', 'perspective'] as const)('preserves %s zoom, pan and orientation across focus and window changes', kind => {
    const camera = kind === 'orthographic' ? new OrthographicCamera(-120, 180, 100, -100, 0.1, 10000)
      : new PerspectiveCamera(42, 1200 / 800, 0.1, 10000);
    camera.position.set(80, 50, 300); camera.lookAt(10, -20, 0);
    camera.zoom = 1.8; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const position = camera.position.clone(), rotation = camera.quaternion.clone(), original = camera.projectionMatrix.clone();
    const points = [new Vector3(0, 0, 0), new Vector3(25, 10, 0), new Vector3(-30, 40, 20)];
    const pixels = (width: number, height: number) => points.flatMap(point => {
      const p = point.clone().project(camera); return [p.x * width / 2, p.y * height / 2];
    });
    const before = pixels(1200, 800);
    let width = 1200, height = 800;
    for (const [nextWidth, nextHeight] of [[1920, 1080], [900, 400], [500, 1000], [1200, 800]]) {
      resizeCamera(camera, width, height, nextWidth, nextHeight);
      pixels(nextWidth, nextHeight).forEach((value, i) => expect(value).toBeCloseTo(before[i], 8));
      expect(camera.position.toArray()).toEqual(position.toArray());
      expect(camera.quaternion.toArray()).toEqual(rotation.toArray());
      expect(camera.zoom).toBe(1.8);
      width = nextWidth; height = nextHeight;
    }
    camera.projectionMatrix.elements.forEach((value, i) => expect(value).toBeCloseTo(original.elements[i], 10));
  });
  it('ignores hidden or invalid viewports', () => {
    const camera = new OrthographicCamera(-100, 100, 100, -100);
    const original = camera.projectionMatrix.clone();
    for (const [width, height] of [[0, 0], [1000, 0], [NaN, 1000], [1000, Infinity]])
      resizeCamera(camera, 1000, 800, width, height);
    expect(camera.projectionMatrix).toEqual(original);
  });
});
