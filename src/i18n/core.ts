import { zh } from './messages';

export type Locale = 'en' | 'zh-CN';
export type MessageKey = keyof typeof zh;
export type LocalizedText = string | Message | LocalizedText[];
export type MessageParams = Record<string, LocalizedText | number | bigint>;
export interface Message { key: MessageKey; params?: MessageParams }
export const LOCALE_STORAGE_KEY = 'closlab.locale';

export function msg(key: MessageKey, params?: MessageParams): Message {
  return { key, params };
}

export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const template = locale === 'zh-CN' ? zh[key] : key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params?.[name];
    if (value === undefined) return placeholder;
    return typeof value === 'number' || typeof value === 'bigint' ? String(value) : formatText(locale, value);
  });
}

/** Messages stay structured across Worker boundaries and are translated only when displayed. */
export function formatText(locale: Locale, value: LocalizedText): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => formatText(locale, item)).join(locale === 'zh-CN' ? '；' : '; ');
  return translate(locale, value.key, value.params);
}

export class LocalizedError extends Error {
  constructor(public readonly text: LocalizedText) {
    super(formatText('en', text));
    this.name = 'LocalizedError';
  }
}

export function errorText(error: unknown, fallback: MessageKey = 'Computation failed'): LocalizedText {
  if (error instanceof LocalizedError) return error.text;
  return error instanceof Error ? error.message : msg(fallback);
}

export function readLocale(storage?: Pick<Storage, 'getItem'>): Locale {
  try { return storage?.getItem(LOCALE_STORAGE_KEY) === 'zh-CN' ? 'zh-CN' : 'en'; }
  catch { return 'en'; }
}
