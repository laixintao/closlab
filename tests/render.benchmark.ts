import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, totalmem, platform, release } from 'node:os';
import { uniformSpec } from '../src/model/defaults';
import { serializeProject } from '../src/model/project';
import { DEFAULT_VIEW } from '../src/model/types';

test('131,072 terminals + 6,144 switches + 2,097,152 links, 30-second full-viewport GPU benchmark', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /GL_INVALID/i.test(message.text())) errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('render-status')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: "Focus mode", exact: true }).click();
  const spec = uniformSpec(64, 2, 100, 8); spec.planes = 8;
  const start = performance.now();
  await page.getByLabel("Import configuration file").setInputFiles({
    name: 'full-fabric.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(spec, DEFAULT_VIEW)),
  });
  const status = page.getByTestId('render-status');
  await expect(status).toHaveAttribute('data-ready', 'true');
  await expect(status).toHaveAttribute('data-nodes', '137216');
  await expect(status).toHaveAttribute('data-links', '2097152');
  await expect(status).toHaveAttribute('data-segments', '2097152');
  const firstInteractiveMs = performance.now() - start;
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/full-fabric.png' });
  await page.getByRole('button', { name: "Run 30-second benchmark", exact: true }).click();
  await expect(page.getByTestId('benchmark-result')).toBeVisible({ timeout: 45000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: "Download benchmark report", exact: true }).click();
  const download = await downloadPromise;
  const report = JSON.parse(await readFile((await download.path())!, 'utf8'));
  const completeReport = {
    ...report, firstInteractiveMs,
    browserVersion: browser.version(),
    hardware: { cpu: cpus()[0].model, cpuCores: cpus().length, memoryGiB: totalmem() / 1024 ** 3, platform: platform(), release: release() },
    targets: { firstInteractiveMs: 5000, medianFps: 30 },
    pass: firstInteractiveMs <= 5000 && report.medianFps >= 30,
    methodology: 'Production build; headless Chrome with GPU; 1920x1080 canvas; DPR 1; no filters or sampling; straight links; automatic orbit for 30 seconds; first second excluded from frame distribution. First interaction includes JSON import and UI readiness polling.',
  };
  await writeFile('artifacts/benchmark.json', JSON.stringify(completeReport, null, 2) + '\n');
  await page.screenshot({ path: 'artifacts/benchmark-result.png' });
  console.log(JSON.stringify(completeReport, null, 2));
  expect(errors).toEqual([]);
  expect(report.nodes).toBe(137216);
  expect(report.links).toBe(2097152);
  expect(report.submittedSegments).toBe(2097152);
  expect([report.width, report.height, report.dpr]).toEqual([1920, 1080, 1]);
  if (process.env.CLOSLAB_ENFORCE_PERF === '1') {
    expect(firstInteractiveMs).toBeLessThanOrEqual(5000);
    expect(report.medianFps).toBeGreaterThanOrEqual(30);
  }
});
