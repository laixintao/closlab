import { Box, ChevronDown } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/core';
import type { LayoutMode } from '../model/types';

const LABELS: Record<LayoutMode, MessageKey> = {
  layered: '3D layered', planes: 'Expanded planes', flat: '2D schematic', radial: 'Radial',
};

export default function LayoutSelect({ value, onChange, disabled = false }: {
  value: LayoutMode; onChange: (layout: LayoutMode) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  return <div className="layout-select"><Box size={14} />
    <select aria-label={t('Topology layout')} value={value} disabled={disabled}
      onChange={event => onChange(event.target.value as LayoutMode)}>
      {Object.entries(LABELS).map(([mode, label]) => <option key={mode} value={mode}>{t(label)}</option>)}
    </select><ChevronDown size={12} />
  </div>;
}
