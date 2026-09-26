import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { EmbedSize } from '../model/share';

/** Keep the iframe's actual viewport size when fitting its preview in the dialog. */
export default function IframePreview({ src, size }: { src: string; size: EmbedSize }) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 600, height: 560 });
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setBounds({ width, height });
    });
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  const width = size.widthUnit === '%' ? Math.max(1, Math.round(bounds.width * size.width / 100)) : size.width;
  const scale = Math.min(1, bounds.width / width, bounds.height / size.height);
  return <section className="share-preview">
    <div className="share-preview-heading"><h3>{t('Preview')}</h3>
      {Math.round(scale * 100) < 100 && <span>{t('Scaled to {percent}%', { percent: Math.round(scale * 100) })}</span>}</div>
    <div ref={host} className="share-preview-viewport">
      <div className="share-preview-page" style={{ width: width * scale, height: size.height * scale }}>
        <iframe src={src} title={t('iframe preview')} allow="fullscreen" width={width} height={size.height}
          style={{ width, height: size.height, transform: `scale(${scale})` }} />
      </div>
    </div>
  </section>;
}
