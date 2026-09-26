import { expect, it } from 'vitest';
import { uniformSpec } from './defaults';
import { iframeMarkup, shareUrls } from './share';
import { DEFAULT_VIEW } from './types';
import { projectFromQuery } from './url';

it('preserves the deployed path and full project, without stale query or hash state', () => {
  const spec = uniformSpec(32, 3);
  spec.tiers[1].reserved = 4; spec.tiers[1].up -= 4;
  const view = { ...DEFAULT_VIEW, layout: 'planes' as const, showEndpoints: false };
  const urls = shareUrls('https://clos.example/tools/clos/?utm_source=old&embed=1#old', spec, view, 'zh-CN');
  const link = new URL(urls.link), embed = new URL(urls.embed);
  expect(link.pathname).toBe('/tools/clos/');
  expect(link.hash).toBe('');
  expect(link.searchParams.has('embed')).toBe(false);
  expect(link.searchParams.has('utm_source')).toBe(false);
  expect(embed.searchParams.get('embed')).toBe('1');
  expect(embed.searchParams.get('lang')).toBe('zh-CN');
  expect(projectFromQuery(embed.search)).toMatchObject({ spec, view });
});

it('escapes iframe attribute contents', () => {
  const markup = iframeMarkup('https://example.com/?a=1&b="<tag>"');
  expect(markup).toContain('src="https://example.com/?a=1&amp;b=&quot;&lt;tag&gt;&quot;"');
  expect(markup).not.toContain('<tag>');
});

it('exports pixel and percentage widths with a custom pixel height', () => {
  const fixed = iframeMarkup('https://clos.example/', { width: 960, widthUnit: 'px', height: 640 });
  expect(fixed).toContain('width="960"');
  expect(fixed).toContain('height="640"');
  const fluid = iframeMarkup('https://clos.example/', { width: 75, widthUnit: '%', height: 480 });
  expect(fluid).toContain('width="75%"');
  expect(fluid).toContain('height="480"');
  expect(() => iframeMarkup('https://clos.example/', { width: 0, widthUnit: 'px', height: 560 })).toThrow();
  expect(() => iframeMarkup('https://clos.example/', { width: 101, widthUnit: '%', height: 560 })).toThrow();
  expect(() => iframeMarkup('https://clos.example/', { width: 800, widthUnit: 'px', height: NaN })).toThrow();
});
