import { Check, Copy, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { iframeMarkup, shareUrls } from '../model/share';
import type { TopologySpec, ViewConfig } from '../model/types';

export default function ShareDialog({ spec, view, onClose }: {
  spec: TopologySpec; view: ViewConfig; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const linkField = useRef<HTMLInputElement>(null), codeField = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null);
  const [failed, setFailed] = useState(false);
  const urls = useMemo(() => shareUrls(window.location.href, spec, view, locale), [spec, view, locale]);
  const code = useMemo(() => iframeMarkup(urls.embed), [urls.embed]);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async (kind: 'link' | 'embed') => {
    setCopied(null); setFailed(false);
    try {
      await navigator.clipboard.writeText(kind === 'link' ? urls.link : code);
      setCopied(kind);
    } catch {
      const field = kind === 'link' ? linkField.current : codeField.current;
      field?.focus(); field?.select(); setFailed(true);
    }
  };
  return <dialog ref={dialog} className="share-dialog" aria-labelledby="share-title" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="share-heading"><h2 id="share-title">{t('Share network')}</h2>
      <button className="icon-button" aria-label={t('Close sharing')} onClick={onClose}><X size={18} /></button></div>
    <div className="share-content">
      <label className="share-link-label" htmlFor="share-link">{t('Network link')}</label>
      <div className="share-link-row"><input id="share-link" ref={linkField} readOnly value={urls.link} onFocus={event => event.currentTarget.select()} />
        <button className="secondary-button" aria-label={t('Copy share link')} onClick={() => void copy('link')}>
          {copied === 'link' ? <Check size={15} /> : <Copy size={15} />}{t(copied === 'link' ? 'Copied' : 'Copy link')}</button></div>
      <div className="share-embed-grid">
        <section className="share-code"><h3>{t('Embed in your blog')}</h3>
          <p>{t('Read-only topology and key parameters.')}</p>
          <textarea ref={codeField} aria-label={t('iframe code')} readOnly spellCheck={false} value={code} onFocus={event => event.currentTarget.select()} />
          <button className="primary-button" aria-label={t('Copy iframe')} onClick={() => void copy('embed')}>
            {copied === 'embed' ? <Check size={16} /> : <Copy size={16} />}{t(copied === 'embed' ? 'Copied' : 'Copy iframe')}</button>
        </section>
        <section className="share-preview"><h3>{t('Preview')}</h3>
          <iframe src={urls.embed} title={t('iframe preview')} allow="fullscreen" />
        </section>
      </div>
      {failed && <p className="share-feedback error-text" role="alert">{t('Copy failed. The text is selected; press Ctrl+C or ⌘C to copy.')}</p>}
      {copied && <span className="visually-hidden" role="status">{t('Copied')}</span>}
    </div>
  </dialog>;
}
