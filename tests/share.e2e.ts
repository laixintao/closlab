import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const example = '/?ports=8&tiers=3&layout=planes&showEndpoints=false';
async function ready(scope: Page | FrameLocator, nodes: number, links: number) {
  const status = scope.getByTestId('render-status');
  await expect(status).toHaveAttribute('data-ready', 'true');
  await expect(status).toHaveAttribute('data-nodes', String(nodes));
  await expect(status).toHaveAttribute('data-links', String(links));
}
const savedProject = (page: Page) => page.evaluate(() => ({
  project: localStorage.getItem('closlab.project.v1'), locale: localStorage.getItem('closlab.locale'),
}));

test('copies an applied, read-only iframe and renders it on another website', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(example);
  await ready(page, 80, 256);
  const stored = await savedProject(page);
  await page.getByLabel('Physical ports', { exact: true }).fill('16');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share network' });
  const preview = page.frameLocator('.share-preview iframe');
  await ready(preview, 80, 256);
  await expect(preview.getByTestId('endpoint-count')).toHaveText('128');
  await expect(preview.getByTestId('switch-count')).toHaveText('80');
  await expect(preview.getByTestId('link-count')).toHaveText('384');
  await expect(preview.locator('input, select, textarea')).toHaveCount(0);
  await expect(preview.getByRole('table')).toContainText('8 × 100 Gbps');
  await preview.getByTestId('network-canvas').click({ position: { x: 240, y: 120 } });
  await expect(preview.getByRole('button', { name: 'Clear selection' })).toBeVisible();
  await preview.getByRole('button', { name: 'Reset view' }).click();
  await page.getByRole('button', { name: 'Copy iframe', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy iframe', exact: true })).toHaveText('Copied');
  const markup = await page.evaluate(() => navigator.clipboard.readText());
  expect(markup).toBe(await page.getByRole('textbox', { name: 'iframe code' }).inputValue());
  const src = await page.evaluate(code => new DOMParser().parseFromString(code, 'text/html').querySelector('iframe')!.src, markup);
  expect(src).toBe(await page.locator('.share-preview iframe').getAttribute('src'));
  expect(new URL(src).searchParams.get('ports')).toBe('8');
  expect(new URL(src).searchParams.get('embed')).toBe('1');
  expect(await savedProject(page)).toEqual(stored);
  const codeBox = await page.getByRole('button', { name: 'Copy iframe' }).boundingBox();
  const previewBox = await page.locator('.share-preview').boundingBox();
  expect(codeBox!.x + codeBox!.width).toBeLessThan(previewBox!.x);
  await page.screenshot({ path: info.outputPath('share-dialog.png') });

  // Native Escape closes the modal and releases the live iframe.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByLabel('Physical ports', { exact: true })).toHaveValue('16');

  const blog = await context.newPage();
  // A real second origin keeps Chrome's local-network classification accurate;
  // intercepted documents are classified as public even at a loopback URL.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body style="margin:24px;max-width:800px"><h1>A Clos network</h1>${markup}</body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await blog.goto(`http://localhost:${(server.address() as AddressInfo).port}/clos-post`);
    const embedded = blog.frameLocator('iframe');
    await ready(embedded, 80, 256);
    await expect(embedded.locator('input, select, textarea')).toHaveCount(0);
    await expect(embedded.getByTestId('bandwidth')).toHaveText('12.8 Tbps');
    await blog.screenshot({ path: info.outputPath('blog-embed.png') });
    const home = embedded.getByRole('link', { name: 'ClosLab home' });
    await expect(home).toHaveAttribute('href', new URL('/', src).href);
    await expect(home).toHaveAttribute('target', '_blank');
    const newTab = context.waitForEvent('page');
    await home.click();
    const homepage = await newTab;
    await expect(homepage.getByRole('button', { name: 'Generate network', exact: true })).toBeVisible();
    expect(await homepage.evaluate(() => window.opener)).toBeNull();
    await ready(embedded, 80, 256);
    await homepage.close();
  } finally {
    await blog.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('iframe dimensions control copied markup and the live viewport without reloading it', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(example);
  await ready(page, 80, 256);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const preview = page.frameLocator('.share-preview iframe');
  await ready(preview, 80, 256);
  await preview.getByTestId('network-canvas').click({ position: { x: 180, y: 120 } });
  await page.getByLabel('Width unit', { exact: true }).selectOption('px');
  await page.getByLabel('iframe width', { exact: true }).fill('960');
  await page.getByLabel('iframe height', { exact: true }).fill('640');
  await expect.poll(() => preview.getByTestId('embed-preview').evaluate(() => [innerWidth, innerHeight])).toEqual([960, 640]);
  await expect(preview.getByRole('button', { name: 'Clear selection' })).toBeVisible();
  await page.getByRole('button', { name: 'Copy iframe', exact: true }).click();
  const code = await page.evaluate(() => navigator.clipboard.readText());
  expect(code).toContain('width="960"'); expect(code).toContain('height="640"');
  const frameBox = await page.locator('.share-preview iframe').boundingBox();
  const viewport = await page.locator('.share-preview-viewport').boundingBox();
  expect(frameBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(frameBox!.height).toBeLessThanOrEqual(viewport!.height);
  await page.screenshot({ path: info.outputPath('custom-iframe-size.png') });

  await page.getByLabel('Width unit', { exact: true }).selectOption('%');
  await page.getByLabel('iframe width', { exact: true }).fill('75');
  await page.getByLabel('iframe height', { exact: true }).fill('480');
  const available = await page.locator('.share-preview-viewport').evaluate(el => el.clientWidth);
  await expect.poll(async () => Math.abs(await preview.getByTestId('embed-preview').evaluate(() => innerWidth) - available * .75)).toBeLessThanOrEqual(1);
  await expect.poll(() => preview.getByTestId('embed-preview').evaluate(() => innerHeight)).toBe(480);
  await page.getByRole('button', { name: 'Copy iframe', exact: true }).click();
  const fluidCode = await page.evaluate(() => navigator.clipboard.readText());
  expect(fluidCode).toContain('width="75%"'); expect(fluidCode).toContain('height="480"');
  await page.getByLabel('iframe width', { exact: true }).fill('101');
  await expect(page.getByRole('button', { name: 'Copy iframe', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('width 1–100');
  await ready(preview, 80, 256);
  await page.getByLabel('iframe width', { exact: true }).fill('100');
  await page.getByLabel('iframe height', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: 'Copy iframe', exact: true })).toBeDisabled();
  await page.getByLabel('iframe height', { exact: true }).fill('560');
  await expect(page.getByRole('button', { name: 'Copy iframe', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('embedded previews do not inherit or overwrite local projects and language preferences', async ({ page }) => {
  await page.goto(example);
  await ready(page, 80, 256);
  await page.getByLabel('Language', { exact: true }).selectOption('zh-CN');
  const stored = await savedProject(page);
  await page.goto('/?embed=1');
  await ready(page, 560, 1024);
  await expect(page.getByTestId('endpoint-count')).toHaveText('512');
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(page).toHaveURL(/\?embed=1$/);
  expect(await savedProject(page)).toEqual(stored);
  await page.goto('/?embed=1&lang=zh-CN&ports=8&tiers=3&showEndpoints=false');
  await ready(page, 80, 256);
  await expect(page.getByRole('button', { name: '重置视图' })).toBeVisible();
  expect(await savedProject(page)).toEqual(stored);
  await page.goto('/');
  await ready(page, 80, 256);
  await expect(page.getByLabel('语言', { exact: true })).toHaveValue('zh-CN');
});

test('selects iframe code for manual copying when clipboard access is unavailable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
    writeText: () => Promise.reject(new Error('Clipboard permission denied')),
  } }));
  await page.goto(example);
  await ready(page, 80, 256);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('button', { name: 'Copy iframe', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('press Ctrl+C or ⌘C');
  const code = page.getByRole('textbox', { name: 'iframe code' });
  await expect(code).toBeFocused();
  expect(await code.evaluate((el: HTMLTextAreaElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
});

test('invalid iframe parameters show an error instead of an unrelated default network', async ({ page }) => {
  await page.goto('/?embed=1&tiers=999');
  await expect(page.getByRole('alert')).toContainText('Invalid preview parameters');
  await expect(page.getByTestId('network-canvas')).toHaveCount(0);
  await expect(page.getByTestId('endpoint-count')).toHaveCount(0);
  await expect(page.locator('input, select, textarea')).toHaveCount(0);
});

test('sharing and the embedded preview fit narrow screens in Chinese', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(example);
  await ready(page, 80, 256);
  await page.getByLabel('Language', { exact: true }).selectOption('zh-CN');
  await page.getByRole('button', { name: '分享', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制 iframe', exact: true })).toBeInViewport();
  const preview = page.frameLocator('.share-preview iframe');
  await ready(preview, 80, 256);
  await expect(preview.getByRole('button', { name: '重置视图' })).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await preview.getByTestId('embed-preview').evaluate(() =>
    document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  expect((await preview.getByTestId('network-canvas').boundingBox())!.height).toBeGreaterThan(150);
  await page.locator('.share-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('share-mobile.png') });
});
