import { Check, Copy, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { DEFAULT_EMBED_SIZE, MAX_EMBED_DIMENSION, iframeMarkup, shareUrls, validEmbedSize, type EmbedSize } from '../model/share';
import type { TopologySpec, ViewConfig } from '../model/types';
import IframePreview from './IframePreview';

export default function ShareDialog({ spec, view, onClose }: {
  spec: TopologySpec; view: ViewConfig; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const linkField = useRef<HTMLInputElement>(null), codeField = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null);
  const [failed, setFailed] = useState(false);
  const [sizeInput, setSizeInput] = useState({ width: String(DEFAULT_EMBED_SIZE.width), widthUnit: DEFAULT_EMBED_SIZE.widthUnit, height: String(DEFAULT_EMBED_SIZE.height) });
  const [size, setSize] = useState(DEFAULT_EMBED_SIZE);
  const validSize = validEmbedSize({ ...sizeInput, width: Number(sizeInput.width), height: Number(sizeInput.height) });
  const widthLimit = sizeInput.widthUnit === '%' ? 100 : MAX_EMBED_DIMENSION;
  const changeSize = (patch: Partial<typeof sizeInput>) => {
    const next = { ...sizeInput, ...patch };
    setSizeInput(next); setCopied(null); setFailed(false);
    const parsed = { ...next, width: Number(next.width), height: Number(next.height) };
    if (validEmbedSize(parsed)) setSize(parsed);
  };
  const urls = useMemo(() => shareUrls(window.location.href, spec, view, locale), [spec, view, locale]);
  const code = useMemo(() => iframeMarkup(urls.embed, size), [urls.embed, size]);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async (kind: 'link' | 'embed') => {
    if (kind === 'embed' && !validSize) return;
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
          <div className="share-size-fields">
            <label className="field"><span>{t('Width')}</span><div className="share-width-input">
              <input aria-label={t('iframe width')} type="number" min="1" max={widthLimit} step="1" value={sizeInput.width}
                aria-invalid={!validSize} aria-describedby={!validSize ? 'iframe-size-error' : undefined}
                onChange={event => changeSize({ width: event.target.value })} />
              <select aria-label={t('Width unit')} value={sizeInput.widthUnit} onChange={event => changeSize({
                widthUnit: event.target.value as EmbedSize['widthUnit'], width: event.target.value === '%' ? '100' : '800',
              })}><option value="%">%</option><option value="px">px</option></select>
            </div></label>
            <label className="field"><span>{t('Height')}</span><div className="input-wrap">
              <input aria-label={t('iframe height')} type="number" min="1" max={MAX_EMBED_DIMENSION} step="1" value={sizeInput.height}
                aria-invalid={!validSize} aria-describedby={!validSize ? 'iframe-size-error' : undefined}
                onChange={event => changeSize({ height: event.target.value })} /><span className="input-suffix">px</span>
            </div></label>
          </div>
          {!validSize && <p id="iframe-size-error" className="error-text" role="alert">{t('Use whole numbers: width 1–{widthMax}, height 1–{heightMax} px.', { widthMax: widthLimit, heightMax: MAX_EMBED_DIMENSION })}</p>}
          <textarea ref={codeField} aria-label={t('iframe code')} readOnly spellCheck={false} value={validSize ? code : ''} onFocus={event => event.currentTarget.select()} />
          <button className="primary-button" aria-label={t('Copy iframe')} disabled={!validSize} onClick={() => void copy('embed')}>
            {copied === 'embed' ? <Check size={16} /> : <Copy size={16} />}{t(copied === 'embed' ? 'Copied' : 'Copy iframe')}</button>
        </section>
        <IframePreview src={urls.embed} size={size} />
      </div>
      {failed && <p className="share-feedback error-text" role="alert">{t('Copy failed. The text is selected; press Ctrl+C or ⌘C to copy.')}</p>}
      {copied && <span className="visually-hidden" role="status">{t('Copied')}</span>}
    </div>
  </dialog>;
}
