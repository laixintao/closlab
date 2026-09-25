import { expect, test } from '@playwright/test';

// A Chinese browser still starts in English unless the user has chosen otherwise.
test.use({ locale: 'zh-CN' });

test('defaults to English, switches without losing work, and remembers the language', async ({ page }, info) => {
  await page.goto('/');
  const status = page.getByTestId('render-status');
  await expect(status).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('ClosLab · Fabric workbench');
  await expect(page.getByRole('heading', { name: 'Network inputs', exact: true })).toBeVisible();
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en');
  await page.screenshot({ path: info.outputPath('english.png') });
  await page.getByLabel('Language', { exact: true }).selectOption('zh-CN');
  await expect(page.getByRole('heading', { name: '网络输入', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('chinese-default.png') });
  await page.getByLabel('语言', { exact: true }).selectOption('en');

  await page.getByLabel('Topology layout', { exact: true }).selectOption('flat');
  await page.getByLabel('Search nodes', { exact: true }).fill('T0-0');
  await page.getByLabel('Search nodes', { exact: true }).press('Enter');
  await expect(page.locator('.node-title')).toContainText('T0-0');
  await page.getByRole('button', { name: 'Target planning', exact: true }).click();
  await page.getByLabel('Target endpoints', { exact: true }).fill('100');
  await expect(status).toHaveAttribute('data-ready', 'true');
  const sharedUrl = page.url();
  const canvas = await page.locator('canvas').elementHandle();

  await page.getByLabel('Language', { exact: true }).selectOption('zh-CN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page).toHaveTitle('ClosLab · Fabric 工作台');
  await expect(page.getByLabel('目标终端数', { exact: true })).toHaveValue('100');
  await expect(page.getByLabel('拓扑布局', { exact: true })).toHaveValue('flat');
  await expect(page.locator('.node-title')).toContainText('T0-0');
  await expect(page.getByTestId('endpoint-count')).toContainText('512');
  await expect(page.getByRole('status')).toContainText('参数待应用');
  expect(page.url()).toBe(sharedUrl);
  expect(await canvas!.evaluate(node => node.isConnected)).toBe(true);
  await page.screenshot({ path: info.outputPath('chinese.png') });

  await page.getByRole('button', { name: '生成网络', exact: true }).click();
  await expect(page.getByTestId('endpoint-count')).toContainText('100');
  await expect(page.locator('.notes-section')).toContainText('最后一个接入组未满配');
  await page.getByLabel('语言', { exact: true }).selectOption('en');
  await expect(page.locator('.notes-section')).toContainText('The final access group is partially filled');
  await page.getByRole('button', { name: 'Capacity details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Capacity details', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Model guide', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Two plane split boundaries');
  await page.getByRole('button', { name: 'Close model guide', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('zh-CN');
  await page.reload();
  await expect(page.getByLabel('语言', { exact: true })).toHaveValue('zh-CN');
  await expect(page.getByTestId('endpoint-count')).toContainText('100');
  await page.getByLabel('语言', { exact: true }).selectOption('en');
  await page.reload();
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en');
});

test('existing validation and import errors update when the language changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-ready', 'true');
  await page.getByLabel('Downlinks', { exact: true }).fill('40');
  await expect(page.getByRole('alert')).toContainText('exceed effective ports');
  await page.getByLabel('Language', { exact: true }).selectOption('zh-CN');
  await expect(page.getByRole('alert')).toContainText('超过有效端口数');
  await expect(page.getByRole('button', { name: '生成网络', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '恢复默认参数', exact: true }).click();
  await page.getByLabel('导入配置文件').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('bad') });
  await expect(page.getByRole('alert')).toContainText('文件不是有效的 JSON');
  await page.getByLabel('语言', { exact: true }).selectOption('en');
  await expect(page.getByRole('alert')).toContainText('File is not valid JSON');
});

test('defaults safely and can switch languages with browser storage blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.goto('/?ports=bad');
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en');
  await expect(page.getByRole('alert')).toContainText('Parameter ports must be numeric');
  await page.getByLabel('Language', { exact: true }).selectOption('zh-CN');
  await expect(page.getByRole('alert')).toContainText('参数 ports 必须是数字');
  await expect(page.getByTestId('endpoint-count')).toContainText('512');
  await page.reload();
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en');
});

test('language and canvas controls remain reachable on mobile in both languages', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-ready', 'true');
  for (const [label, language, focus, exit, reset, shareLabel] of [
    ['Language', 'zh-CN', '专注模式', '退出专注模式', '重置视图', '复制分享链接'],
    ['语言', 'en', 'Focus mode', 'Exit focus mode', 'Reset view', 'Copy share link'],
  ]) {
    await page.getByLabel(label, { exact: true }).selectOption(language);
    await expect(page.getByRole('button', { name: shareLabel, exact: true })).toBeVisible();
    await page.locator('.canvas-toolbar').scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: focus, exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: reset, exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('mobile-' + language + '.png'), fullPage: true });
    await page.getByRole('button', { name: focus, exact: true }).click();
    await expect(page.getByRole('button', { name: exit, exact: true })).toBeInViewport();
    await page.getByRole('button', { name: exit, exact: true }).click();
  }
});
