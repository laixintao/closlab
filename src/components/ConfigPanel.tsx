import { ArrowRight, ChevronDown, Cpu, Layers3, Network, RotateCcw, Settings2 } from 'lucide-react';
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
export default function ConfigPanel({ spec, setSpec, errors, busy, dirty, onApply, onReset }:
  { spec: TopologySpec; setSpec: (spec: TopologySpec) => void; errors: Diagnostic[];
    busy: boolean; dirty: boolean; onApply: () => void; onReset: () => void }) {
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
    <div className="config-heading"><div><span className="section-step">01</span><Settings2 size={15} /><h2 id="input-heading">网络输入</h2><p>配置目标规模、网络结构与交换机规格</p></div>
      <div className="config-heading-actions">
        <span className="input-state">{dirty ? '参数待应用' : busy ? '正在生成…' : '参数已应用'}</span>
        <button className="quiet-button" title="恢复默认参数" aria-label="恢复默认参数" onClick={onReset}><RotateCcw size={13} /><span>恢复默认</span></button>
        <button className="primary-button" onClick={onApply} disabled={errors.length > 0}>
          {busy ? '重新计算网络' : '生成网络'}<ArrowRight size={14} />
        </button>
      </div>
    </div>
    <div className="config-grid">
      <section className="config-section">
        <div className="section-label"><Network size={13} /> 计算方式</div>
        <div className="segmented mode-select">
          <button className={spec.mode === 'capacity' ? 'active' : ''} onClick={() => update({ mode: 'capacity' })}>最大容量</button>
          <button className={spec.mode !== 'capacity' ? 'active' : ''} onClick={() => update({ mode: 'endpoints' })}>目标规划</button>
        </div>
        <p className="field-hint">{spec.mode === 'capacity' ? '从端口和层数推导满配网络。' : '按目标规模填充，保留完整上行路径。'}</p>
        {spec.mode !== 'capacity' && <div className="target-fields">
          <label className="field"><span>规划依据</span><div className="select-wrap"><select aria-label="规划依据" value={spec.mode}
            onChange={e => update({ mode: e.target.value as 'endpoints' | 'bandwidth' })}>
            <option value="endpoints">终端数量</option><option value="bandwidth">总注入带宽</option>
          </select><ChevronDown size={13} /></div></label>
          {spec.mode === 'endpoints'
            ? <NumberField label="目标终端数" value={spec.targetEndpoints} min={1} suffix="个" onChange={v => update({ targetEndpoints: v })} />
            : <NumberField label="目标总注入带宽" value={spec.targetBandwidthTbps} step={0.1} min={0.001} suffix="Tbps" onChange={v => update({ targetBandwidthTbps: v })} />}
        </div>}
      </section>
      <section className="config-section">
        <div className="section-label"><Layers3 size={13} /> 组网规则</div>
        <label className="field"><span>交换机层数 <small>终端不计入 Tier</small></span>
          <div className="tier-picker">{[2, 3, 4, 5].map(t => <button key={t} aria-label={t + ' tier'}
            className={spec.tiers.length === t ? 'active' : ''} onClick={() => setTierCount(t)}>{t}<small> tier</small></button>)}</div>
        </label>
        <div className="field-grid">
          <NumberField label="平面数量" value={spec.planes} min={1} suffix="planes" onChange={v => update({ planes: v })} />
          <label className="field"><span>分平面起点</span><div className="select-wrap">
            <select aria-label="分平面起点" value={spec.planeStart} onChange={e => update({ planeStart: Number(e.target.value) })}>
              <option value={0}>终端接入</option>
              {spec.tiers.slice(1).map((_, i) => <option key={i} value={i + 1}>T{i} 上方</option>)}
            </select><ChevronDown size={13} /></div>
          </label>
        </div>
        <p className="field-hint">{spec.planeStart === 0 ? '每个终端接入每个平面；交换 Fabric 独立。' : '按上行选择维度划分平面；下层共享。'}</p>
      </section>
      <section className="config-section hardware-section">
        <div className="section-label"><Cpu size={13} /> 交换机规格</div>
        <div className="hardware-toolbar">
          <div className="tier-tabs">{spec.tiers.map((_, i) => <button key={i} className={activeTier === i ? 'active' : ''}
            aria-label={'编辑 T' + i} onClick={() => setTier(i)}>T{i}<span>{i === 0 ? '接入' : i === spec.tiers.length - 1 ? '顶层' : '汇聚'}</span></button>)}</div>
          <label className="check-row"><input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)} />同步硬件规格到所有层</label>
        </div>
        <div className="hardware-fields">
          <div className="hardware-profile"><div className="field-grid">
            <NumberField label="物理端口数" value={current.ports} min={1} onChange={v => updateProfile('ports', v)} />
            <NumberField label="Breakout" value={current.breakout} min={1} suffix="×" onChange={v => updateProfile('breakout', v)} />
            <NumberField label="芯片交换带宽" value={current.chipTbps} step={0.1} min={0.001} suffix="Tbps" onChange={v => updateProfile('chipTbps', v)} />
            <NumberField label="逻辑端口速率" value={current.portGbps} step={0.001} min={0.001} suffix="Gbps" onChange={v => updateProfile('portGbps', v)} />
          </div></div>
          <div className="hardware-allocation">
            <div className="allocation-label"><span>端口分配</span><span>{top ? '顶层全部向下' : '下行 / 上行 / 预留'}</span></div>
            <div className="field-grid three">
              <NumberField label="下行" value={current.down} min={1} onChange={v => updateProfile('down', v)} />
              <NumberField label="上行" value={current.up} min={top ? 0 : 1} disabled={top} onChange={v => updateProfile('up', v)} />
              <NumberField label="预留" value={current.reserved} onChange={v => updateProfile('reserved', v)} />
            </div>
            <div className="port-bar" aria-label="端口分配比例">
              <span className="port-down" style={{ width: Math.max(0, Math.min(100, current.down / effective * 100)) + '%' }} />
              <span className="port-up" style={{ width: Math.max(0, Math.min(100, current.up / effective * 100)) + '%' }} />
              <span className="port-reserved" style={{ width: Math.max(0, Math.min(100, current.reserved / effective * 100)) + '%' }} />
            </div>
            <div className="allocation-foot"><span><i className="dot teal" />下行 <i className="dot violet" />上行</span>
              <span className={free < 0 ? 'error-text' : ''}>未分配 {Number.isFinite(free) ? free : '—'}</span></div>
            <div className="effective-ports"><span>有效逻辑端口</span><strong>{Number.isFinite(effective) ? formatCount(effective) : '—'} <small>ports</small></strong></div>
          </div>
        </div>
      </section>
    </div>
    {errors.length > 0 && <div className="validation-errors" role="alert">{errors.map((e, i) => <p key={i}>{e.message}</p>)}</div>}
  </section>;
}
