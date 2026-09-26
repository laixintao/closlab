import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatText, LOCALE_STORAGE_KEY, readLocale, translate, type Locale, type LocalizedText, type MessageKey, type MessageParams } from './core';

interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
  text: (value: LocalizedText) => string;
}
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('embed') === '1') return params.get('lang') === 'zh-CN' ? 'zh-CN' : 'en';
    try { return readLocale(window.localStorage); } catch { return 'en'; }
  });
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, 'ClosLab · Fabric workbench');
    document.querySelector('meta[name="description"]')?.setAttribute('content',
      translate(locale, 'ClosLab — Clos network capacity planning and full-topology visualization'));
  }, [locale]);
  const value = useMemo<I18n>(() => ({
    locale,
    setLocale(next) {
      updateLocale(next);
      try { window.localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* Language switching also works without browser storage. */ }
    },
    t: (key, params) => translate(locale, key, params),
    text: message => formatText(locale, message),
  }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n requires I18nProvider');
  return context;
}
