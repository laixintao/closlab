import type { Locale } from '../i18n/core';
import type { TopologySpec, ViewConfig } from './types';
import { projectToQuery } from './url';

export function shareUrls(base: string, spec: TopologySpec, view: ViewConfig, locale: Locale) {
  const link = new URL(base);
  link.search = projectToQuery(spec, view);
  link.hash = '';
  const embed = new URL(link);
  embed.searchParams.set('embed', '1');
  embed.searchParams.set('lang', locale);
  return { link: link.href, embed: embed.href };
}

export function iframeMarkup(url: string): string {
  const src = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<iframe\n  src="${src}"\n  title="ClosLab network preview"\n  width="100%"\n  height="560"\n  style="border: 0;"\n  loading="lazy"\n  allow="fullscreen"\n></iframe>`;
}
