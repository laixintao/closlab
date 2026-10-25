import { MathUtils, OrthographicCamera, PerspectiveCamera } from 'three';

/** Resize the viewport while preserving the view's center and pixel scale. */
export function resizeCamera(camera: OrthographicCamera | PerspectiveCamera,
  oldWidth: number, oldHeight: number, width: number, height: number) {
  if ([oldWidth, oldHeight, width, height].some(size => !Number.isFinite(size) || size <= 0)) return;
  if (camera instanceof OrthographicCamera) {
    const centerX = (camera.left + camera.right) / 2, centerY = (camera.top + camera.bottom) / 2;
    const halfWidth = (camera.right - camera.left) / 2 * width / oldWidth;
    const halfHeight = (camera.top - camera.bottom) / 2 * height / oldHeight;
    camera.left = centerX - halfWidth; camera.right = centerX + halfWidth;
    camera.top = centerY + halfHeight; camera.bottom = centerY - halfHeight;
  } else {
    const halfFov = MathUtils.degToRad(camera.fov / 2);
    camera.fov = MathUtils.radToDeg(2 * Math.atan(Math.tan(halfFov) * height / oldHeight));
    camera.aspect = width / height;
  }
  camera.updateProjectionMatrix();
}
