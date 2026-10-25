import { expect, test } from '@playwright/test';

test('2D schematic groups Pods below Spine blocks and retains device and ECMP interaction', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?ports=8&tiers=3&layout=flat&showEndpoints=false');
  const status = page.getByTestId('render-status');
  await expect(status).toHaveAttribute('data-ready', 'true');
  await expect(status).toHaveAttribute('data-nodes', '80');
  await expect(status).toHaveAttribute('data-segments', '256');
  await expect(page.locator('.topology-label').filter({ hasText: /^Pod / })).toHaveCount(8);
  await expect(page.locator('.topology-label').filter({ hasText: /^Spine · P/ })).toHaveCount(4);
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
  await expect(page.locator('.topology-label:visible').filter({ hasText: /^Spine · P/ })).toHaveCount(4);
  await page.screenshot({ path: info.outputPath('clos-2d-schematic.png') });
  await page.getByRole('button', { name: 'Exit focus mode', exact: true }).click();
  await page.getByLabel('Search nodes', { exact: true }).fill('T1-0');
  await page.getByLabel('Search nodes', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'T1-0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.getByLabel('Source node', { exact: true }).fill('T0-0');
  await page.getByLabel('Destination node', { exact: true }).fill('T0-4');
  await page.getByRole('button', { name: 'Show all paths', exact: true }).click();
  await expect(page.getByTestId('all-paths-result')).toContainText('Shortest paths: 16 · Hops per path: 4');
  await expect(page.getByTestId('all-paths-result')).toContainText('Highlighted nodes: 26 · Unique links: 40');
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.screenshot({ path: info.outputPath('clos-2d-ecmp.png') });
  await page.getByLabel('Topology layout', { exact: true }).selectOption('planes');
  await expect(page.locator('.topology-label').filter({ hasText: /^Plane / })).toHaveCount(4);
  await page.getByLabel('Topology layout', { exact: true }).selectOption('flat');
  await expect(page.locator('.topology-label').filter({ hasText: /^Spine · P/ })).toHaveCount(4);
  await expect(status).toHaveAttribute('data-segments', '256');
  expect(errors).toEqual([]);
});

test('F16 schematic keeps all 64 Pods, 16 Spine blocks and all physical links', async ({ page }, info) => {
  await page.goto('/?tiers=3&ports=128&chipTbps=12.8&portGbps=100&t0.ports=32&t0.chipTbps=3.2&t0.down=16&t0.up=16&t2.down=64&t2.reserved=64&mode=capacity&planes=16&planeStart=1&layout=flat&showEndpoints=false');
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-nodes', '6144');
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-segments', '131072');
  await expect(page.locator('.topology-label').filter({ hasText: /^Pod / })).toHaveCount(64);
  await expect(page.locator('.topology-label').filter({ hasText: /^Spine · P/ })).toHaveCount(16);
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
  await page.screenshot({ path: info.outputPath('f16-2d-detail.png') });
  await page.getByRole('button', { name: 'Fit all', exact: true }).click();
  await page.screenshot({ path: info.outputPath('f16-2d-overview.png') });
});

for (const target of ['layered', 'planes']) test(`returning from 2D restores ${target} without stale links`, async ({ page }) => {
  await page.goto(`/?ports=8&tiers=3&layout=${target}&showEndpoints=true`);
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-ready', 'true');
  const canvas = page.getByTestId('network-canvas').locator('canvas');
  const selector = page.getByLabel('Topology layout', { exact: true });
  for (const selected of [false, true]) {
    if (selected) {
      await page.getByLabel('Search nodes', { exact: true }).fill('T1-0');
      await page.getByLabel('Search nodes', { exact: true }).press('Enter');
    }
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await page.mouse.move(0, 0);
    // Two equal captures ensure the initial GPU frame has reached the compositor.
    let baseline = await canvas.screenshot({ style: '.selection-chip { visibility: hidden !important; }' });
    await expect.poll(async () => {
      const next = await canvas.screenshot({ style: '.selection-chip { visibility: hidden !important; }' });
      const equal = next.equals(baseline); baseline = next; return equal;
    }).toBe(true);
    // Also cover a page opened directly in 2D: stale buffers can otherwise
    // retain the initial 3D coordinates and hide a failed round trip.
    await page.goto('/?ports=8&tiers=3&layout=flat&showEndpoints=true');
    await expect(page.getByTestId('render-status')).toHaveAttribute('data-ready', 'true');
    if (selected) {
      await page.getByLabel('Search nodes', { exact: true }).fill('T1-0');
      await page.getByLabel('Search nodes', { exact: true }).press('Enter');
    }
    for (const mode of [target, 'flat', target]) {
      await selector.selectOption(mode);
      await expect(selector).toBeEnabled();
      await expect(page.locator('.topology-label').filter({ hasText: mode === 'flat' ? /^Spine · P/ : /^Plane / })).toHaveCount(4);
      await page.mouse.move(0, 0);
      if (mode === target) await expect.poll(async () => (await canvas.screenshot({ style: '.selection-chip { visibility: hidden !important; }' })).equals(baseline)).toBe(true);
    }
  }
});
