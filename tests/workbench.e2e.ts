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
  await page.getByLabel('导入配置文件').setInputFiles({
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
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-draw-calls', '3');
  const input = await page.getByRole('region', { name: '网络输入', exact: true }).boundingBox();
  const results = await page.getByRole('region', { name: '计算结果', exact: true }).boundingBox();
  expect(input!.y + input!.height).toBeLessThan(results!.y);
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const canvas = await page.getByTestId('network-canvas').boundingBox();
    expect(canvas!.y + canvas!.height).toBeLessThanOrEqual(viewport.height);
    expect(canvas!.height).toBeGreaterThan(240);
    await expect(page.getByRole('button', { name: '生成网络', exact: true })).toBeInViewport();
    if (viewport.width === 1366) await page.screenshot({ path: info.outputPath('laptop-workbench.png') });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.screenshot({ path: info.outputPath('default-workbench.png'), fullPage: true });
  await page.getByRole('button', { name: '容量明细', exact: true }).click();
  await page.screenshot({ path: info.outputPath('capacity-workbench.png'), fullPage: true });
});
test('four layouts and elbow segments preserve the physical graph', async ({ page }, info) => {
  for (const mode of ['planes', 'flat', 'radial', 'layered']) {
    await page.getByLabel('拓扑布局', { exact: true }).selectOption(mode);
    await ready(page);
  }
  await page.getByRole('button', { name: '折线', exact: true }).click();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-segments', '3072');
  await page.getByLabel('拓扑布局', { exact: true }).selectOption('flat');
  await ready(page);
  await page.screenshot({ path: info.outputPath('flat-elbow.png'), fullPage: true });
  const spec = uniformSpec(); spec.planes = 8; spec.planeStart = 1;
  await importSpec(page, spec);
  await ready(page);
  await page.getByLabel('拓扑布局', { exact: true }).selectOption('planes');
  await page.getByLabel('着色方式', { exact: true }).selectOption('plane');
  await page.getByRole('button', { name: '专注模式', exact: true }).click();
  await page.screenshot({ path: info.outputPath('shared-leaf-plane-colors.png') });
  await page.getByRole('button', { name: '折线', exact: true }).click();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-segments', '3072');
  await page.screenshot({ path: info.outputPath('shared-leaf-plane-colors-elbow.png') });
  await page.getByLabel('拓扑布局', { exact: true }).selectOption('flat');
  await ready(page);
  await page.screenshot({ path: info.outputPath('shared-leaf-plane-rows-2d.png') });
});
test('single-plane three-tier networks expose connectivity groups in both line modes', async ({ page }, info) => {
  await page.goto('/?ports=8&tiers=3&planes=1');
  await ready(page, 208, 384);
  await expect(page.getByLabel('着色方式', { exact: true })).toHaveValue('plane');
  await expect(page.locator('.canvas-legend')).toContainText('4 个连接分组');
  for (const [node, group] of [['T1-0', 'G0'], ['T1-4', 'G0'], ['T2-0', 'G0'], ['T1-1', 'G1'], ['T0-0', '各组共享']]) {
    await page.getByLabel('搜索节点', { exact: true }).fill(node);
    await page.getByLabel('搜索节点', { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: node, exact: true })).toBeVisible();
    await expect(page.locator('.node-inspector .detail-list > div').filter({ hasText: '连接分组' })).toContainText(group);
  }
  await page.getByRole('button', { name: '清除选择', exact: true }).click();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-draw-calls', '3');
  await page.screenshot({ path: info.outputPath('implicit-groups-straight.png') });
  await page.getByRole('button', { name: '折线', exact: true }).click();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-segments', '1152');
  await page.screenshot({ path: info.outputPath('implicit-groups-elbow.png') });
  await page.reload();
  await ready(page, 208, 384);
  await expect(page.locator('.canvas-legend')).toContainText('4 个连接分组');
  await page.getByLabel('着色方式', { exact: true }).selectOption('tier');
  await expect(page.locator('.canvas-legend')).toContainText('T2');
  await expect(page.locator('.canvas-legend')).not.toContainText('连接分组');
  await ready(page, 208, 384);
});
test('plans a partial network, finds paths, searches and picks a GPU-rendered node', async ({ page }) => {
  await page.getByRole('button', { name: '目标规划', exact: true }).click();
  await page.getByLabel('目标终端数', { exact: true }).fill('100');
  await expect(page.getByTestId('endpoint-count')).toContainText('512');
  await expect(page.getByRole('status')).toContainText('当前显示上次生成结果');
  await page.getByRole('button', { name: '生成网络', exact: true }).click();
  await ready(page, 123, 212);
  await expect(page.getByTestId('switch-count')).toContainText('23');
  await expect(page.getByRole('status')).toContainText('已与输入同步');
  await page.getByLabel('目的节点', { exact: true }).fill('E-99');
  await page.getByRole('button', { name: '查看最短路径', exact: true }).click();
  await expect(page.locator('.path-result')).toContainText('4 条链路');
  await page.getByLabel('搜索节点', { exact: true }).fill('E-0');
  await page.getByLabel('搜索节点', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'E-0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除选择', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E-0', exact: true })).toHaveCount(0);
  await page.getByTestId('network-canvas').click();
  await expect(page.getByRole('heading', { name: 'E-0', exact: true })).toBeVisible();
});
test('rejects port over-allocation and keeps the applied topology unchanged', async ({ page }) => {
  await page.getByLabel('下行', { exact: true }).fill('40');
  await expect(page.getByRole('alert')).toContainText('有效端口');
  await expect(page.getByRole('button', { name: '生成网络', exact: true })).toBeDisabled();
  await ready(page);
});
test('selects the nearest switch from empty space and highlights every direct connection', async ({ page }, info) => {
  await page.getByLabel('搜索节点', { exact: true }).fill('T0-0');
  await page.getByLabel('搜索节点', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'T0-0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除选择', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'T0-0', exact: true })).toHaveCount(0);
  const canvas = page.getByTestId('network-canvas');
  const box = await canvas.boundingBox();
  // Deliberately miss the device: the nearest projected node still gets selected.
  await canvas.click({ position: { x: box!.width / 2 + 55, y: box!.height / 2 } });
  await expect(page.getByRole('heading', { name: 'T0-0', exact: true })).toBeVisible();
  await expect(page.locator('.selection-chip')).toContainText('32 条直连链路');
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-draw-calls', '5');
  await ready(page);
  await page.screenshot({ path: info.outputPath('selected-switch.png'), fullPage: true });
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(page.locator('.selection-chip')).toContainText('32 条直连链路');
  await page.getByRole('button', { name: '清除选择', exact: true }).click();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-draw-calls', '3');
});
test('builds 100,000 terminals through ordinary parameter controls and draws every link', async ({ page }, info) => {
  await page.getByRole('button', { name: '目标规划', exact: true }).click();
  await page.getByLabel('目标终端数', { exact: true }).fill('100000');
  await page.getByLabel('平面数量', { exact: true }).fill('8');
  await page.getByLabel('物理端口数', { exact: true }).fill('64');
  await page.getByLabel('芯片交换带宽', { exact: true }).fill('51.2');
  await page.getByLabel('Breakout', { exact: true }).fill('8');
  await expect(page.getByLabel('逻辑端口速率', { exact: true })).toHaveValue('100');
  await page.getByRole('button', { name: '生成网络', exact: true }).click();
  await ready(page, 105176, 1600768);
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-segments', '1600768');
  await expect(page.getByTestId('switch-count')).toContainText('5,176');
  await page.getByLabel('拓扑布局', { exact: true }).selectOption('planes');
  await ready(page, 105176, 1600768);
  await page.getByLabel('着色方式', { exact: true }).selectOption('plane');
  await page.screenshot({ path: info.outputPath('100k-multiplane.png'), fullPage: true });
  await page.getByLabel('筛选平面', { exact: true }).selectOption('3');
  await ready(page, 100647, 200096);
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await ready(page, 105176, 1600768);
  await page.getByRole('button', { name: '专注模式', exact: true }).click();
  await page.screenshot({ path: info.outputPath('100k-plane-rows.png') });
  await page.getByLabel('拓扑布局', { exact: true }).selectOption('flat');
  await ready(page, 105176, 1600768);
  await page.screenshot({ path: info.outputPath('100k-plane-rows-2d.png') });
  await page.getByRole('button', { name: '查看全图', exact: true }).click();
  await ready(page, 105176, 1600768);
  await page.screenshot({ path: info.outputPath('100k-planes-2d-overview.png') });
  await page.getByRole('button', { name: '复位视角', exact: true }).click();
});
test('exports, imports and restores a project including view settings', async ({ page }) => {
  await page.getByRole('button', { name: '3 tier', exact: true }).click();
  await page.getByLabel('物理端口数', { exact: true }).fill('8');
  await page.getByRole('button', { name: '生成网络', exact: true }).click();
  await ready(page, 208, 384);
  await page.getByLabel('拓扑布局', { exact: true }).selectOption('radial');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出配置', exact: true }).click();
  const file = await pending;
  const exported = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(exported.spec.tiers).toHaveLength(3);
  expect(exported.view.layout).toBe('radial');
  await page.reload();
  await ready(page, 208, 384);
  await expect(page.getByLabel('拓扑布局', { exact: true })).toHaveValue('radial');
  await page.getByLabel('导入配置文件').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.getByRole('alert')).toContainText('ClosLab v1');
  await importSpec(page, uniformSpec());
  await ready(page);
});
test('shows exact capacity above the rendering budget without allocating the graph', async ({ page }) => {
  await importSpec(page, uniformSpec(512, 4, 100));
  await expect(page.getByTestId('endpoint-count')).toContainText('8,589,934,592');
  await expect(page.getByRole('heading', { name: '容量已计算，规模超出渲染预算', exact: true })).toBeVisible();
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-nodes', '0');
  await page.getByRole('button', { name: '容量明细', exact: true }).click();
  await expect(page.getByRole('heading', { name: '每一层，都有据可查。', exact: true })).toBeVisible();
});
test('mobile layout remains scrollable and usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '模型说明', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '关闭模型说明', exact: true }).click();
  await page.getByTestId('network-canvas').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('mobile-workbench.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('shares applied parameters and restores the network independently of local storage', async ({ page, context }) => {
  await page.getByRole('button', { name: '目标规划', exact: true }).click();
  await page.getByLabel('目标终端数', { exact: true }).fill('100');
  expect(new URL(page.url()).searchParams.get('mode')).toBe('capacity');
  await page.getByRole('button', { name: '生成网络', exact: true }).click();
  await ready(page, 123, 212);
  await page.getByLabel('拓扑布局', { exact: true }).selectOption('flat');
  await page.getByLabel('着色方式', { exact: true }).selectOption('plane');
  await expect(page).toHaveURL(/layout=flat/);
  const shared = page.url();
  expect(new URL(shared).searchParams.get('endpoints')).toBe('100');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制分享链接', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制分享链接', exact: true })).toContainText('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shared);
  await importSpec(page, uniformSpec());
  await ready(page);
  await page.goto(shared);
  await ready(page, 123, 212);
  await expect(page.getByLabel('拓扑布局', { exact: true })).toHaveValue('flat');
  await expect(page.getByLabel('着色方式', { exact: true })).toHaveValue('plane');
  await page.reload();
  await ready(page, 123, 212);
  await page.goto('/?tiers=999');
  await expect(page.getByRole('alert')).toContainText('分享链接参数无效');
  await ready(page);
});
