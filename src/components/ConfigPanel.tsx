import { useI18n } from '../i18n/I18nProvider';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { uniformSpec } from '../model/defaults';
import { formatCount } from '../model/format';
import type { Diagnostic, SwitchProfile, TopologySpec } from '../model/types';
import { useState } from 'react';

function NumberField({ label, value, onChange, suffix, min = 0, step = 1, disabled = false }:
  { label: string; value: number; onChange: (value: number) => void; suffix?: string; min?: number; step?: number; disabled?: boolean }) {
  return <label className="field"><span>{label}</span><div className="input-wrap">
    <input aria-label={label} type="number" min={min} step={step} value={Number.isNaN(value) ? '' : value}
      disabled={disabled} onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
    {suffix && <span className="input-suffix">{suffix}</span>}
  </div></label>;
}
export default function ConfigPanel({ spec, setSpec, errors, busy, onApply, onReset }:
  { spec: TopologySpec; setSpec: (spec: TopologySpec) => void; errors: Diagnostic[];
    busy: boolean; onApply: () => void; onReset: () => void }) {
  const { t, text } = useI18n();
  const [tier, setTier] = useState(0), [sync, setSync] = useState(true);
  const activeTier = Math.min(tier, spec.tiers.length - 1);
  const current = spec.tiers[activeTier], top = activeTier === spec.tiers.length - 1;
  const update = (patch: Partial<TopologySpec>) => setSpec({ ...spec, ...patch });
  const updateProfile = (field: keyof SwitchProfile, value: number) => {
    const hardware = ['ports', 'breakout', 'chipTbps', 'portGbps'].includes(field);
    const tiers = spec.tiers.map((p, i) => {
      if (i !== activeTier && !(sync && hardware)) return p;
      const next = { ...p, [field]: value };
      if (hardware && field !== 'portGbps') {
        next.portGbps = Math.floor(next.chipTbps * 1000 / (next.ports * next.breakout) * 1000 + 1e-6) / 1000;
      }
      if (field === 'ports' || field === 'breakout') {
        const available = next.ports * next.breakout - next.reserved;
        next.down = i === spec.tiers.length - 1 ? available : Math.ceil(available / 2);
        next.up = i === spec.tiers.length - 1 ? 0 : Math.floor(available / 2);
      }
      return next;
    });
    update({ tiers });
  };
  const setTierCount = (count: number) => {
    const base = spec.tiers[0], defaults = uniformSpec(base.ports, count, base.portGbps, base.breakout);
    const tiers = defaults.tiers.map((fallback, i) => {
      const p = { ...(spec.tiers[i] ?? { ...fallback, chipTbps: base.chipTbps }) };
      if (i === count - 1) { p.up = 0; p.down = p.ports * p.breakout - p.reserved; }
      else if (!p.up) {
        const available = p.ports * p.breakout - p.reserved;
        p.down = Math.ceil(available / 2); p.up = Math.floor(available / 2);
      }
      return p;
    });
    update({ tiers, planeStart: Math.min(spec.planeStart, count - 1) });
  };
  const effective = current.ports * current.breakout;
  const free = effective - current.down - current.up - current.reserved;
  return <section className="config-panel" aria-labelledby="input-heading">
    <div className="config-heading"><div><h2 id="input-heading">{t("Network inputs")}</h2></div>
      <div className="config-heading-actions">
        <button className="quiet-button" title={t("Restore default inputs")} aria-label={t("Restore default inputs")} onClick={onReset}><RotateCcw size={13} /><span>{t("Restore defaults")}</span></button>
        <button className="primary-button" onClick={onApply} disabled={errors.length > 0}>
          {busy ? t("Rebuild network") : t("Generate network")}
        </button>
      </div>
    </div>
    <div className="config-grid">
      <section className="config-section">
        <div className="section-label">{t("Calculation mode")}</div>
        <div className="segmented mode-select">
          <button aria-pressed={spec.mode === 'capacity'} className={spec.mode === 'capacity' ? 'active' : ''} onClick={() => update({ mode: 'capacity' })}>{t("Maximum capacity")}</button>
          <button aria-pressed={spec.mode !== 'capacity'} className={spec.mode !== 'capacity' ? 'active' : ''} onClick={() => update({ mode: 'endpoints' })}>{t("Target planning")}</button>
        </div>
        <p className="field-hint">{spec.mode === 'capacity' ? t("Derive full capacity from ports and tiers.") : t("Fill to the target while preserving all uplink paths.")}</p>
        {spec.mode !== 'capacity' && <div className="target-fields">
          <label className="field"><span>{t("Plan by")}</span><div className="select-wrap"><select aria-label={t("Plan by")} value={spec.mode}
            onChange={e => update({ mode: e.target.value as 'endpoints' | 'bandwidth' })}>
            <option value="endpoints">{t("Endpoints")}</option><option value="bandwidth">{t("Total injection bandwidth")}</option>
          </select><ChevronDown size={13} /></div></label>
          {spec.mode === 'endpoints'
            ? <NumberField label={t("Target endpoints")} value={spec.targetEndpoints} min={1} onChange={v => update({ targetEndpoints: v })} />
            : <NumberField label={t("Target injection bandwidth")} value={spec.targetBandwidthTbps} step={0.1} min={0.001} suffix="Tbps" onChange={v => update({ targetBandwidthTbps: v })} />}
        </div>}
      </section>
      <section className="config-section">
        <div className="section-label">{t("Topology rules")}</div>
        <label className="field"><span>{t("Switch tiers")} <small>{t("Excludes endpoints")}</small></span>
          <div className="tier-picker">{[2, 3, 4, 5].map(count => <button key={count} aria-label={count + ' ' + t('tier')}
            className={spec.tiers.length === count ? 'active' : ''} onClick={() => setTierCount(count)}>{count}<small> {t('tier')}</small></button>)}</div>
        </label>
        <div className="field-grid">
          <NumberField label={t("Plane count")} value={spec.planes} min={1} onChange={v => update({ planes: v })} />
          <label className="field"><span>{t("Plane boundary")}</span><div className="select-wrap">
            <select aria-label={t("Plane split boundary")} value={spec.planeStart} onChange={e => update({ planeStart: Number(e.target.value) })}>
              <option value={0}>{t("Endpoint access")}</option>
              {spec.tiers.slice(1).map((_, i) => <option key={i} value={i + 1}>{t('Above T{tier}', { tier: i })}</option>)}
            </select><ChevronDown size={13} /></div>
          </label>
        </div>
        <p className="field-hint">{spec.planes === 1 && spec.tiers.length >= 3 ? t("Independent upper planes are detected, laid out, and colored automatically.")
          : spec.planeStart === 0 ? t("Each endpoint connects to every independent fabric.") : t("Split uplink choices into planes; share lower tiers.")}</p>
      </section>
      <section className="config-section hardware-section">
        <div className="section-label">{t("Switch hardware")}</div>
        <div className="hardware-toolbar">
          <div className="tier-tabs">{spec.tiers.map((_, i) => <button key={i} className={activeTier === i ? 'active' : ''}
            aria-label={t('Edit T{tier}', { tier: i })} onClick={() => setTier(i)}>T{i}<span>{i === 0 ? t("Access") : i === spec.tiers.length - 1 ? t("Top") : t("Aggregation")}</span></button>)}</div>
          <label className="check-row"><input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)} />{t("Sync hardware across tiers")}</label>
        </div>
        <div className="hardware-fields">
          <div className="hardware-profile"><div className="field-grid">
            <NumberField label={t("Physical ports")} value={current.ports} min={1} onChange={v => updateProfile('ports', v)} />
            <NumberField label={t('Breakout')} value={current.breakout} min={1} suffix="×" onChange={v => updateProfile('breakout', v)} />
            <NumberField label={t("ASIC bandwidth")} value={current.chipTbps} step={0.1} min={0.001} suffix="Tbps" onChange={v => updateProfile('chipTbps', v)} />
            <NumberField label={t("Logical port speed")} value={current.portGbps} step={0.001} min={0.001} suffix="Gbps" onChange={v => updateProfile('portGbps', v)} />
          </div></div>
          <div className="hardware-allocation">
            <div className="allocation-label"><span>{t("Port allocation")}</span><span>{top ? t("All top-tier ports face down") : t("Down / Up / Reserved")}</span></div>
            <div className="field-grid three">
              <NumberField label={t("Downlinks")} value={current.down} min={1} onChange={v => updateProfile('down', v)} />
              <NumberField label={t("Uplinks")} value={current.up} min={top ? 0 : 1} disabled={top} onChange={v => updateProfile('up', v)} />
              <NumberField label={t("Reserved")} value={current.reserved} onChange={v => updateProfile('reserved', v)} />
            </div>
            <div className="port-bar" aria-label={t("Port allocation ratio")}>
              <span className="port-down" style={{ width: Math.max(0, Math.min(100, current.down / effective * 100)) + '%' }} />
              <span className="port-up" style={{ width: Math.max(0, Math.min(100, current.up / effective * 100)) + '%' }} />
              <span className="port-reserved" style={{ width: Math.max(0, Math.min(100, current.reserved / effective * 100)) + '%' }} />
            </div>
            <div className="allocation-foot"><span><i className="dot teal" />{t("Downlinks")} <i className="dot violet" />{t("Uplinks")}</span>
              <span className={free < 0 ? 'error-text' : ''}>{t('Unassigned {count}', { count: Number.isFinite(free) ? free : '—' })}</span></div>
            <div className="effective-ports"><span>{t("Effective logical ports")}</span><strong>{Number.isFinite(effective) ? formatCount(effective) : '—'} <small>{t('ports')}</small></strong></div>
          </div>
        </div>
      </section>
    </div>
    {errors.length > 0 && <div className="validation-errors" role="alert">{errors.map((e, i) => <p key={i}>{text(e.message)}</p>)}</div>}
  </section>;
}
