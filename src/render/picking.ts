/** Select the closest projected node in CSS pixels, respecting filters and camera clipping. */
export function nearestNode(
  positions: Float32Array, visible: Uint8Array, matrix: ArrayLike<number>,
  width: number, height: number, clickX: number, clickY: number,
): number | null {
  let best: number | null = null, distance = Infinity, depth = Infinity;
  for (let n = 0; n < visible.length; n++) {
    if (!visible[n]) continue;
    const x = positions[n * 3], y = positions[n * 3 + 1], z = positions[n * 3 + 2];
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    if (w <= 0) continue;
    const px = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w;
    const py = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w;
    const pz = (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w;
    if (px < -1 || px > 1 || py < -1 || py > 1 || pz < -1 || pz > 1) continue;
    const dx = (px + 1) * width / 2 - clickX;
    const dy = (1 - py) * height / 2 - clickY;
    const d = dx * dx + dy * dy;
    if (d < distance || (d === distance && pz < depth)) {
      best = n; distance = d; depth = pz;
    }
  }
  return best;
}
