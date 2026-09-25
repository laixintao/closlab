import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { uniformSpec } from '../src/model/defaults';
import { DEFAULT_VIEW, type TopologySpec } from '../src/model/types';
import { serializeProject } from '../src/model/project';

async function ready(page: Page, nodes = 560, links = 1024) {
  const status = page.getByTestId('render-status');
  await expect(status).toHaveAttribute('data-ready', 'true');
  await expect(status).toHaveAttribute('data-nodes', String(nodes));
  await expect(status).toHaveAttribute('data-links', String(links));
}
async function importSpec(page: Page, spec: TopologySpec) {
  await page.getByLabel("Import configuration file").setInputFiles({
    name: 'network.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(spec, DEFAULT_VIEW)),
  });
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /GL_INVALID|GL_INVALID_OPERATION|GPU stall.*error/i.test(message.text())) errors.push(message.text());
  });
  (page as Page & { appErrors: string[] }).appErrors = errors;
  await page.goto('/');
  await ready(page);
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { appErrors: string[] }).appErrors).toEqual([]);
});
test('default graph draws real nodes and links without browser errors', async ({ page }, info) => {
  await expect(page.getByTestId('endpoint-count')).toContainText('512');
  await expect(page.getByTestId('switch-count')).toContainText('48');
  await expect(page.getByTestId('link-count')).toContainText('1,024');
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-segments', '1024');
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-draw-calls', '4');
  const input = await page.getByRole('region', { name: "Network inputs", exact: true }).boundingBox();
  const results = await page.getByRole('region', { name: "Results", exact: true }).boundingBox();
  expect(input!.y + input!.height).toBeLessThan(results!.y);
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const canvas = await page.getByTestId('network-canvas').boundingBox();
    expect(canvas!.y + canvas!.height).toBeLessThanOrEqual(viewport.height);
    expect(canvas!.height).toBeGreaterThan(240);
    await expect(page.getByRole('button', { name: "Generate network", exact: true })).toBeInViewport();
    if (viewport.width === 1366) await page.screenshot({ path: info.outputPath('laptop-workbench.png') });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.screenshot({ path: info.outputPath('default-workbench.png'), fullPage: true });
  await page.getByRole('button', { name: "Capacity details", exact: true }).click();
  await page.screenshot({ path: info.outputPath('capacity-workbench.png'), fullPage: true });
});
test('four layouts and elbow segments preserve the physical graph', async ({ page }, info) => {
  for (const mode of ['planes', 'flat', 'radial', 'layered']) {
    await page.getByLabel("Topology layout", { exact: true }).selectOption(mode);
    await ready(page);
  }
  await page.getByRole('button', { name: "Orthogonal", exact: true }).click();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-segments', '3072');
  await page.getByLabel("Topology layout", { exact: true }).selectOption('flat');
  await ready(page);
  await page.screenshot({ path: info.outputPath('flat-elbow.png'), fullPage: true });
  const spec = uniformSpec(); spec.planes = 8; spec.planeStart = 1;
  await importSpec(page, spec);
  await ready(page);
  await page.getByLabel("Topology layout", { exact: true }).selectOption('planes');
  await page.getByRole('button', { name: "Focus mode", exact: true }).click();
  await page.screenshot({ path: info.outputPath('shared-leaf-plane-colors.png') });
  await page.getByRole('button', { name: "Orthogonal", exact: true }).click();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-segments', '3072');
  await page.screenshot({ path: info.outputPath('shared-leaf-plane-colors-elbow.png') });
  await page.getByLabel("Topology layout", { exact: true }).selectOption('flat');
  await ready(page);
  await page.screenshot({ path: info.outputPath('shared-leaf-plane-rows-2d.png') });
});
test('single-plane three-tier networks expose connectivity groups in both line modes', async ({ page }, info) => {
  await page.goto('/?ports=8&tiers=3&planes=1&colorBy=tier');
  await ready(page, 208, 384);
  await expect(page.getByTestId('color-mode')).toContainText("Auto");
  await expect(page.locator('.canvas-legend')).toContainText("4 auto planes");
  for (const [node, group] of [['T1-0', 'P0'], ['T1-4', 'P0'], ['T2-0', 'P0'], ['T1-1', 'P1'], ['T0-0', "Shared by all planes"]]) {
    await page.getByLabel("Search nodes", { exact: true }).fill(node);
    await page.getByLabel("Search nodes", { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: node, exact: true })).toBeVisible();
    await expect(page.locator('.node-inspector .detail-list > div').filter({ hasText: "Plane membership" })).toContainText(group);
  }
  await page.getByRole('button', { name: "Clear selection", exact: true }).click();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-draw-calls', '4');
  await page.screenshot({ path: info.outputPath('implicit-groups-straight.png') });
  await page.getByRole('button', { name: "Orthogonal", exact: true }).click();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-segments', '1152');
  await page.screenshot({ path: info.outputPath('implicit-groups-elbow.png') });
  await page.reload();
  await ready(page, 208, 384);
  await expect(page.locator('.canvas-legend')).toContainText("4 auto planes");
  await page.getByLabel("Show endpoints", { exact: true }).uncheck();
  await ready(page, 80, 256);
  await expect(page.getByTestId('endpoint-count')).toContainText('128');
  await page.reload();
  await ready(page, 80, 256);
  await page.getByLabel("Filter plane", { exact: true }).selectOption('1');
  await ready(page, 44, 64);
  await page.getByLabel("Filter plane", { exact: true }).selectOption('all');
  await page.getByLabel("Show endpoints", { exact: true }).check();
  await ready(page, 208, 384);
});
test('shows the reference arrangement with four automatic planes and four perpendicular Pods', async ({ page }, info) => {
  await page.goto('/?tiers=3&ports=128&chipTbps=12.8&portGbps=100&t0.ports=32&t0.chipTbps=3.2&t0.down=16&t0.up=4&t0.reserved=12&t1.down=48&t1.up=48&t1.reserved=32&t2.down=48&t2.reserved=80&mode=endpoints&endpoints=3072&layout=planes&showEndpoints=false&opacity=0.12');
  await ready(page, 400, 1536);
  await expect(page.locator('.canvas-legend')).toContainText("4 auto planes");
  await expect(page.getByTestId('switch-count')).toContainText('400');
  await page.getByRole('button', { name: "Focus mode", exact: true }).click();
  await expect(page.locator('.topology-label').filter({ hasText: /^Pod / })).toHaveCount(4);
  await expect(page.locator('.topology-label').filter({ hasText: /^Plane / })).toHaveCount(4);
  await page.screenshot({ path: info.outputPath('reference-four-planes.png') });
});
test('F16 Pod and plane filters isolate the corresponding ToRs and Fabric switches', async ({ page }, info) => {
  await page.goto('/?tiers=3&ports=128&chipTbps=12.8&portGbps=100&t0.ports=32&t0.chipTbps=3.2&t0.down=16&t0.up=16&t2.down=64&t2.reserved=64&mode=capacity&planes=16&planeStart=1&layout=planes&showEndpoints=false');
  await ready(page, 6144, 131072);
  await expect(page.locator('.topology-label').filter({ hasText: /^Pod / })).toHaveCount(64);
  await expect(page.locator('.composition-list > div').filter({ hasText: 'T1' })).toContainText('1,024');
  await expect(page.locator('.composition-list > div').filter({ hasText: 'T2' })).toContainText('1,024');
  await expect(page.locator('.canvas-legend')).toContainText("Pods below · Planes above");
  const fabricColors: string[] = [];
  for (const node of ['T1-0', 'T1-15', 'T1-16']) {
    await page.getByLabel("Search nodes", { exact: true }).fill(node);
    await page.getByLabel("Search nodes", { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: node, exact: true })).toBeVisible();
    fabricColors.push(await page.locator('.node-title > span').evaluate(el => getComputedStyle(el).backgroundColor));
  }
  expect(fabricColors[0]).toBe(fabricColors[1]);
  expect(fabricColors[0]).not.toBe(fabricColors[2]);
  await page.getByRole('button', { name: "Clear selection", exact: true }).click();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.getByLabel("Filter Pod", { exact: true }).fill('0');
  await ready(page, 1104, 2048);
  await page.screenshot({ path: info.outputPath('f16-pod-colors-straight.png') });
  await page.getByRole('button', { name: "Orthogonal", exact: true }).click();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-segments', '6144');
  await page.screenshot({ path: info.outputPath('f16-pod-colors-elbow.png') });
  await page.getByRole('button', { name: "Straight", exact: true }).click();
  await page.getByLabel("Filter plane", { exact: true }).selectOption('0');
  await ready(page, 129, 128);
  await page.getByRole('button', { name: "Clear filters", exact: true }).click();
  await ready(page, 6144, 131072);
  await page.getByRole('button', { name: "Focus mode", exact: true }).click();
  await page.screenshot({ path: info.outputPath('f16-pods-and-planes.png') });
});
test('highlights all ECMP routes, switches line modes, and clears results', async ({ page }, info) => {
  await page.goto('/?ports=8&tiers=3&layout=planes&showEndpoints=false');
  await ready(page, 80, 256);
  await page.getByLabel("Source node", { exact: true }).fill('T0-0');
  await page.getByLabel("Destination node", { exact: true }).fill('T0-4');
  await page.getByRole('button', { name: "Show all paths", exact: true }).click();
  await expect(page.getByTestId('all-paths-result')).toContainText("Shortest paths: 16 · Hops per path: 4");
  await expect(page.getByTestId('all-paths-result')).toContainText("Highlighted nodes: 26 · Unique links: 40");
  await expect(page.locator('.selection-chip')).toContainText("All shortest paths: 16");
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-draw-calls', '6');
  await page.screenshot({ path: info.outputPath('all-ecmp-paths.png') });
  await page.getByRole('button', { name: "Orthogonal", exact: true }).click();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-segments', '768');
  await expect(page.getByTestId('all-paths-result')).toBeVisible();
  await page.getByRole('button', { name: "Clear path", exact: true }).click();
  await expect(page.getByTestId('all-paths-result')).toHaveCount(0);
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-draw-calls', '4');
  await page.getByRole('button', { name: "View shortest path", exact: true }).click();
  await expect(page.locator('.path-result')).toContainText("Links: 4");
  await page.getByRole('button', { name: "Show all paths", exact: true }).click();
  await expect(page.getByTestId('all-paths-result')).toBeVisible();
  await page.getByLabel("Destination node", { exact: true }).fill('T0-0');
  await expect(page.getByTestId('all-paths-result')).toHaveCount(0);
  await page.getByRole('button', { name: "Show all paths", exact: true }).click();
  await expect(page.getByTestId('all-paths-result')).toContainText("Shortest paths: 1 · Hops per path: 0");
  await page.getByLabel("Destination node", { exact: true }).fill('T0-999999');
  await page.getByRole('button', { name: "Show all paths", exact: true }).click();
  await expect(page.getByText("Path endpoint not found. Check the source and destination node IDs.", { exact: true })).toBeVisible();
  await expect(page.getByTestId('all-paths-result')).toHaveCount(0);
});
test('plans a partial network, finds paths, searches and picks a GPU-rendered node', async ({ page }) => {
  await page.getByRole('button', { name: "Target planning", exact: true }).click();
  await page.getByLabel("Target endpoints", { exact: true }).fill('100');
  await expect(page.getByTestId('endpoint-count')).toContainText('512');
  await expect(page.getByRole('status')).toContainText("Showing previous results");
  await page.getByRole('button', { name: "Generate network", exact: true }).click();
  await ready(page, 123, 212);
  await expect(page.getByTestId('switch-count')).toContainText('23');
  await expect(page.getByRole('status')).toContainText("Inputs and results are in sync");
  await page.getByLabel("Destination node", { exact: true }).fill('E-99');
  await page.getByRole('button', { name: "View shortest path", exact: true }).click();
  await expect(page.locator('.path-result')).toContainText("Links: 4");
  await page.getByLabel("Search nodes", { exact: true }).fill('E-0');
  await page.getByLabel("Search nodes", { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'E-0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: "Clear selection", exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E-0', exact: true })).toHaveCount(0);
  await page.getByTestId('network-canvas').click();
  await expect(page.getByRole('heading', { name: 'E-0', exact: true })).toBeVisible();
});
test('rejects port over-allocation and keeps the applied topology unchanged', async ({ page }) => {
  await page.getByLabel("Downlinks", { exact: true }).fill('40');
  await expect(page.getByRole('alert')).toContainText("effective ports");
  await expect(page.getByRole('button', { name: "Generate network", exact: true })).toBeDisabled();
  await ready(page);
});
test('selects the nearest switch from empty space and highlights every direct connection', async ({ page }, info) => {
  await page.getByLabel("Search nodes", { exact: true }).fill('T0-0');
  await page.getByLabel("Search nodes", { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'T0-0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: "Clear selection", exact: true }).click();
  await expect(page.getByRole('heading', { name: 'T0-0', exact: true })).toHaveCount(0);
  const canvas = page.getByTestId('network-canvas');
  const box = await canvas.boundingBox();
  // Deliberately miss the device: the nearest projected node still gets selected.
  await canvas.click({ position: { x: box!.width / 2 + 55, y: box!.height / 2 } });
  await expect(page.getByRole('heading', { name: 'T0-0', exact: true })).toBeVisible();
  await expect(page.locator('.selection-chip')).toContainText("Direct links: 32");
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-draw-calls', '6');
  await ready(page);
  await page.screenshot({ path: info.outputPath('selected-switch.png'), fullPage: true });
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(page.locator('.selection-chip')).toContainText("Direct links: 32");
  await page.getByRole('button', { name: "Clear selection", exact: true }).click();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-draw-calls', '4');
});
test('builds 100,000 terminals through ordinary parameter controls and draws every link', async ({ page }, info) => {
  await page.getByRole('button', { name: "Target planning", exact: true }).click();
  await page.getByLabel("Target endpoints", { exact: true }).fill('100000');
  await page.getByLabel("Plane count", { exact: true }).fill('8');
  await page.getByLabel("Physical ports", { exact: true }).fill('64');
  await page.getByLabel("ASIC bandwidth", { exact: true }).fill('51.2');
  await page.getByLabel('Breakout', { exact: true }).fill('8');
  await expect(page.getByLabel("Logical port speed", { exact: true })).toHaveValue('100');
  await page.getByRole('button', { name: "Generate network", exact: true }).click();
  await ready(page, 105176, 1600768);
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-segments', '1600768');
  await expect(page.getByTestId('switch-count')).toContainText('5,176');
  await page.getByLabel("Topology layout", { exact: true }).selectOption('planes');
  await ready(page, 105176, 1600768);
  await page.screenshot({ path: info.outputPath('100k-multiplane.png'), fullPage: true });
  await page.getByLabel("Filter plane", { exact: true }).selectOption('3');
  await ready(page, 100647, 200096);
  await page.getByRole('button', { name: "Clear filters", exact: true }).click();
  await ready(page, 105176, 1600768);
  await page.getByRole('button', { name: "Focus mode", exact: true }).click();
  await page.screenshot({ path: info.outputPath('100k-plane-rows.png') });
  await page.getByLabel("Topology layout", { exact: true }).selectOption('flat');
  await ready(page, 105176, 1600768);
  await page.screenshot({ path: info.outputPath('100k-plane-rows-2d.png') });
  await page.getByRole('button', { name: "Fit all", exact: true }).click();
  await ready(page, 105176, 1600768);
  await page.screenshot({ path: info.outputPath('100k-planes-2d-overview.png') });
  await page.getByRole('button', { name: "Reset camera", exact: true }).click();
});
test('exports, imports and restores a project including view settings', async ({ page }) => {
  await page.getByRole('button', { name: '3 tier', exact: true }).click();
  await page.getByLabel("Physical ports", { exact: true }).fill('8');
  await page.getByRole('button', { name: "Generate network", exact: true }).click();
  await ready(page, 208, 384);
  await page.getByLabel("Topology layout", { exact: true }).selectOption('radial');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: "Export configuration", exact: true }).click();
  const file = await pending;
  const exported = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(exported.spec.tiers).toHaveLength(3);
  expect(exported.view.layout).toBe('radial');
  await page.reload();
  await ready(page, 208, 384);
  await expect(page.getByLabel("Topology layout", { exact: true })).toHaveValue('radial');
  await page.getByLabel("Import configuration file").setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.getByRole('alert')).toContainText('ClosLab v1');
  await importSpec(page, uniformSpec());
  await ready(page);
});
test('shows exact capacity above the rendering budget without allocating the graph', async ({ page }) => {
  await importSpec(page, uniformSpec(512, 4, 100));
  await expect(page.getByTestId('endpoint-count')).toContainText('8,589,934,592');
  await expect(page.getByRole('heading', { name: "Capacity calculated; rendering limit exceeded", exact: true })).toBeVisible();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-nodes', '0');
  await page.getByRole('button', { name: "Capacity details", exact: true }).click();
  await expect(page.getByRole('heading', { name: "Every tier, accounted for.", exact: true })).toBeVisible();
});
test('mobile layout remains scrollable and usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: "Model guide", exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: "Close model guide", exact: true }).click();
  await page.getByTestId('network-canvas').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('mobile-workbench.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('shares applied parameters and restores the network independently of local storage', async ({ page, context }) => {
  await page.getByRole('button', { name: "Target planning", exact: true }).click();
  await page.getByLabel("Target endpoints", { exact: true }).fill('100');
  expect(new URL(page.url()).searchParams.get('mode')).toBe('capacity');
  await page.getByRole('button', { name: "Generate network", exact: true }).click();
  await ready(page, 123, 212);
  await page.getByLabel("Topology layout", { exact: true }).selectOption('flat');
  await expect(page).toHaveURL(/layout=flat/);
  const shared = page.url();
  expect(new URL(shared).searchParams.get('endpoints')).toBe('100');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: "Copy share link", exact: true }).click();
  await expect(page.getByRole('button', { name: "Copy share link", exact: true })).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shared);
  await importSpec(page, uniformSpec());
  await ready(page);
  await page.goto(shared);
  await ready(page, 123, 212);
  await expect(page.getByLabel("Topology layout", { exact: true })).toHaveValue('flat');
  await expect(page.getByTestId('color-mode')).toContainText("Auto");
  await page.reload();
  await ready(page, 123, 212);
  await page.goto('/?tiers=999');
  await expect(page.getByRole('alert')).toContainText("Invalid share-link parameters");
  await ready(page);
});
