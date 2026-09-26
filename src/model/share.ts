import type { Locale } from '../i18n/core';
import type { TopologySpec, ViewConfig } from './types';
import { projectToQuery } from './url';

export interface EmbedSize { width: number; widthUnit: '%' | 'px'; height: number }
export const DEFAULT_EMBED_SIZE: EmbedSize = { width: 100, widthUnit: '%', height: 560 };
export const MAX_EMBED_DIMENSION = 4096;
export function validEmbedSize(size: EmbedSize): boolean {
  return (size.widthUnit === '%' || size.widthUnit === 'px') &&
    Number.isInteger(size.width) && size.width >= 1 && size.width <= (size.widthUnit === '%' ? 100 : MAX_EMBED_DIMENSION) &&
    Number.isInteger(size.height) && size.height >= 1 && size.height <= MAX_EMBED_DIMENSION;
}

export function shareUrls(base: string, spec: TopologySpec, view: ViewConfig, locale: Locale) {
  const link = new URL(base);
  link.search = projectToQuery(spec, view);
  link.hash = '';
  const embed = new URL(link);
  embed.searchParams.set('embed', '1');
  embed.searchParams.set('lang', locale);
  return { link: link.href, embed: embed.href };
}

export function iframeMarkup(url: string, size: EmbedSize = DEFAULT_EMBED_SIZE): string {
  if (!validEmbedSize(size)) throw new Error('Invalid iframe dimensions');
  const src = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const width = `${size.width}${size.widthUnit === '%' ? '%' : ''}`;
  return `<iframe\n  src="${src}"\n  title="ClosLab network preview"\n  width="${width}"\n  height="${size.height}"\n  style="border: 0;"\n  loading="lazy"\n  allow="fullscreen"\n></iframe>`;
}
