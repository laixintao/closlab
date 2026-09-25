import { describe, expect, it } from 'vitest';
import { calculate } from '../model/engine';
import { uniformSpec } from '../model/defaults';
import { projectFromQuery } from '../model/url';
import { errorText, formatText, LOCALE_STORAGE_KEY, msg, readLocale, translate } from './core';
import { zh } from './messages';

describe('language preference', () => {
  it('defaults to English for absent, unsupported, and unavailable storage', () => {
    expect(readLocale()).toBe('en');
    for (const value of [null, '', 'fr', 'zh', 'en']) {
      expect(readLocale({ getItem: () => value })).toBe('en');
    }
    expect(readLocale({ getItem: () => { throw new Error('Storage blocked'); } })).toBe('en');
    expect(readLocale({ getItem: key => key === LOCALE_STORAGE_KEY ? 'zh-CN' : null })).toBe('zh-CN');
  });
});

describe('localized messages', () => {
  it('keeps translation placeholders complete', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const [english, chinese] of Object.entries(zh)) {
      expect(chinese.trim(), english).not.toBe('');
      expect(placeholders(chinese), english).toEqual(placeholders(english));
    }
  });

  it('formats interpolation values literally, including zero and replacement symbols', () => {
    expect(translate('en', 'Parameter {key} must be numeric', { key: '$&' })).toBe('Parameter $& must be numeric');
    expect(translate('zh-CN', 'Shortest paths: {count} · Hops per path: {hops}', { count: 1n, hops: 0 }))
      .toBe('1 条等长最短路径 · 每条 0 跳');
  });

  it('translates model diagnostics and warnings after crossing a Worker boundary', () => {
    const spec = uniformSpec();
    spec.tiers[0].down = 40;
    let diagnostic;
    try { calculate(spec); } catch (error) { diagnostic = structuredClone(errorText(error)); }
    expect(diagnostic).toBeDefined();
    expect(formatText('en', diagnostic!)).toContain('T0: Downlink, uplink, and reserved ports exceed effective ports');
    expect(formatText('zh-CN', diagnostic!)).toContain('T0：上下行与预留端口之和超过有效端口数');

    const partial = uniformSpec(); partial.mode = 'endpoints'; partial.targetEndpoints = 100;
    const warnings = structuredClone(calculate(partial).warnings);
    expect(formatText('en', warnings)).toContain('partially filled');
    expect(formatText('zh-CN', warnings)).toContain('最后一个接入组未满配');
  });

  it('preserves parameter names in nested share-link errors across language changes', () => {
    let detail;
    try { projectFromQuery('?ports=invalid'); } catch (error) { detail = errorText(error); }
    const message = msg('Invalid share-link parameters; defaults loaded: {error}', { error: detail! });
    expect(formatText('en', message)).toContain('Parameter ports must be numeric');
    expect(formatText('zh-CN', message)).toContain('参数 ports 必须是数字');
  });
});
