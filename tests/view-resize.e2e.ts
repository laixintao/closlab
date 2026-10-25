import { expect, test, type Page } from '@playwright/test';

// Label anchors use the same projected coordinates as the GPU-rendered graph.
// Measuring relative to the canvas center distinguishes a camera reset from
// the surrounding UI moving when focus mode opens or closes.
async function anchors(page: Page) {
  const host = page.getByTestId('network-canvas');
  const box = (await host.boundingBox())!;
  const result: number[] = [];
  for (const pod of [3, 4]) {
    const label = host.locator('.topology-label').filter({ hasText: new RegExp(`^Pod ${pod}$`) });
    await expect(label).toBeVisible();
    const point = (await label.boundingBox())!;
    result.push(point.x + point.width / 2 - box.x - box.width / 2,
      point.y + point.height - box.y - box.height / 2);
  }
  return result;
}
async function expectAnchors(page: Page, expected: number[]) {
  await expect.poll(async () => {
    const actual = await anchors(page);
    return Math.max(...actual.map((value, i) => Math.abs(value - expected[i])));
  }).toBeLessThan(0.75);
}

test('Escape, focus controls, resizing and hidden tabs preserve the current 2D view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?ports=8&tiers=3&layout=flat&showEndpoints=false');
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
  await expect(page.locator('.canvas-shell')).toHaveClass(/is-focused/);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const initial = await anchors(page);
  const box = (await page.getByTestId('network-canvas').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => {
    const now = await anchors(page);
    return now[2] - now[0];
  }).toBeGreaterThan(initial[2] - initial[0] + 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 28, y + 12, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  // Wait for OrbitControls' inertial panning to settle before comparing views.
  await expect.poll(async () => {
    const a = await anchors(page);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const b = await anchors(page);
    return Math.max(...b.map((value, i) => Math.abs(value - a[i])));
  }).toBeLessThan(0.05);
  const panned = await anchors(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.canvas-shell')).not.toHaveClass(/is-focused/);
  await expectAnchors(page, panned);
  const deviceRow = (await page.locator('.topology-label').filter({ hasText: /^Pod 3$/ }).boundingBox())!;
  await page.mouse.click(deviceRow.x + deviceRow.width / 2, deviceRow.y + deviceRow.height + 10);
  await expect(page.locator('.selection-chip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.selection-chip')).toBeHidden();
  await expectAnchors(page, panned);
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
  await expectAnchors(page, panned);
  await page.getByRole('button', { name: 'Exit focus mode', exact: true }).click();
  await expectAnchors(page, panned);
  await page.setViewportSize({ width: 1500, height: 950 });
  await expectAnchors(page, panned);
  await page.getByRole('button', { name: 'Capacity details', exact: true }).click();
  await expect(page.getByTestId('network-canvas')).toBeHidden();
  await page.getByRole('button', { name: 'Topology', exact: true }).click();
  await expectAnchors(page, panned);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect.poll(async () => {
    const actual = await anchors(page);
    return Math.max(...actual.map((value, i) => Math.abs(value - panned[i])));
  }).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});
