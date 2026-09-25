import { expect, test, type Page } from '@playwright/test';

async function focusNode(page: Page, id: string) {
  await page.getByLabel('Search nodes', { exact: true }).fill(id);
  await page.getByLabel('Search nodes', { exact: true }).press('Enter');
  await expect(page.locator('.node-title')).toContainText(id);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
}

async function clickNearFocusedNode(page: Page) {
  const canvas = page.getByTestId('network-canvas'), box = await canvas.boundingBox();
  await canvas.click({ position: { x: box!.width / 2 + 20, y: box!.height / 2 } });
}

test('picks path endpoints from the graph and preserves manual input and normal selection', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-ready', 'true');
  await focusNode(page, 'T0-0');
  const source = page.getByLabel('Source node', { exact: true });
  const target = page.getByLabel('Destination node', { exact: true });
  const pickSource = page.getByRole('button', { name: 'Pick source from graph', exact: true });
  await pickSource.click();
  await expect(pickSource).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('path-pick-prompt')).toContainText('set the source');
  await expect(page.locator('canvas')).toHaveCSS('cursor', 'crosshair');
  await page.screenshot({ path: info.outputPath('pick-source.png') });
  await clickNearFocusedNode(page);
  await expect(source).toHaveValue('T0-0');
  await expect(pickSource).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('path-pick-prompt')).toHaveCount(0);
  await expect(page.locator('.node-title')).toHaveCount(0);

  await focusNode(page, 'T1-0');
  await target.click();
  await expect(page.getByTestId('path-pick-prompt')).toContainText('set the destination');
  await clickNearFocusedNode(page);
  await expect(target).toHaveValue('T1-0');
  await expect(source).toHaveValue('T0-0');
  await expect(page.locator('.node-title')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all paths', exact: true }).click();
  await expect(page.getByTestId('all-paths-result')).toContainText('Shortest paths: 1 · Hops per path: 1');
  await expect(page.getByTestId('all-paths-result')).toContainText('T0-0 → T1-0');

  await pickSource.click();
  await expect(page.getByTestId('all-paths-result')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('path-pick-prompt')).toHaveCount(0);
  await expect(source).toHaveValue('T0-0');
  await clickNearFocusedNode(page);
  await expect(page.locator('.node-title')).toContainText('T1-0');
  await pickSource.click();
  await source.fill('E-0');
  await expect(page.getByTestId('path-pick-prompt')).toHaveCount(0);
  await expect(source).toHaveValue('E-0');
  expect(errors).toEqual([]);
});

test('keeps node picking active across languages and supports explicit cancellation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Pick destination from graph', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('zh-CN');
  await expect(page.getByTestId('path-pick-prompt')).toContainText('点击节点设置终点');
  const pickTarget = page.getByRole('button', { name: '从拓扑点选目的节点', exact: true });
  await expect(pickTarget).toHaveAttribute('aria-pressed', 'true');
  await pickTarget.click();
  await expect(page.getByTestId('path-pick-prompt')).toHaveCount(0);
  await page.getByLabel('源节点', { exact: true }).click();
  await page.getByRole('button', { name: '取消点选节点', exact: true }).click();
  await expect(page.getByTestId('path-pick-prompt')).toHaveCount(0);
  await expect(page.getByLabel('源节点', { exact: true })).toHaveValue('E-0');
  await expect(page.getByLabel('目的节点', { exact: true })).toHaveValue('E-1');
});
