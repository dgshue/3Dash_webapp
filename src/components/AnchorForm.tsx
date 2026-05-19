import { useState, useEffect, useCallback } from 'react';
import type { AnchorConfig, LightPosition } from '../types';
import { ANCHOR_CALIBRATION_DEFAULTS } from '../types';
import { FormPanel, AccordionSection } from './FormPanel';

interface Props {
  open: boolean;
  editAnchor: AnchorConfig | null;
  position: LightPosition;
  onPositionChange: (pos: LightPosition) => void;
  onSave: (cfg: AnchorConfig) => void;
  onClose: () => void;
  onEnterPickMode: () => void;
  onExitPickMode: () => void;
  placingMode: boolean;
}

const FLOORS = ['Main', 'Upper'];

export default function AnchorForm({
  open,
  editAnchor,
  position,
  onPositionChange,
  onSave,
  onClose,
  onEnterPickMode,
  onExitPickMode,
  placingMode,
}: Props) {
  const [deviceId, setDeviceId] = useState('');
  const [label, setLabel] = useState('');
  const [floor, setFloor] = useState('Main');
  const [floorOther, setFloorOther] = useState('');
  // Phase 2: calibration values (blank string === "use default" placeholder).
  const [refPower, setRefPower] = useState<string>('');
  const [pathLossExp, setPathLossExp] = useState<string>('');
  const [antennaGainDbi, setAntennaGainDbi] = useState<string>('');
  const [trustWeight, setTrustWeight] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    if (editAnchor) {
      setDeviceId(editAnchor.deviceId);
      setLabel(editAnchor.label || '');
      if (FLOORS.includes(editAnchor.floor)) {
        setFloor(editAnchor.floor);
        setFloorOther('');
      } else {
        setFloor('__other__');
        setFloorOther(editAnchor.floor);
      }
      setRefPower(editAnchor.refPower !== undefined ? String(editAnchor.refPower) : '');
      setPathLossExp(editAnchor.pathLossExp !== undefined ? String(editAnchor.pathLossExp) : '');
      setAntennaGainDbi(editAnchor.antennaGainDbi !== undefined ? String(editAnchor.antennaGainDbi) : '');
      setTrustWeight(editAnchor.trustWeight !== undefined ? String(editAnchor.trustWeight) : '');
    } else {
      setDeviceId('');
      setLabel('');
      setFloor('Main');
      setFloorOther('');
      setRefPower('');
      setPathLossExp('');
      setAntennaGainDbi('');
      setTrustWeight('');
    }
  }, [editAnchor, open]);

  const handlePosChange = useCallback(
    (axis: 'x' | 'y' | 'z', value: number) => {
      onPositionChange({ ...position, [axis]: parseFloat(value.toFixed(3)) });
    },
    [position, onPositionChange],
  );

  const handlePick = useCallback(() => {
    if (placingMode) onExitPickMode();
    else onEnterPickMode();
  }, [placingMode, onEnterPickMode, onExitPickMode]);

  const parseOptionalFloat = (raw: string): number | undefined => {
    const t = raw.trim();
    if (t === '') return undefined;
    const v = parseFloat(t);
    return isFinite(v) ? v : undefined;
  };

  const handleSave = useCallback(() => {
    const id = deviceId.trim();
    if (!id) {
      alert('Device ID is required');
      return;
    }
    const resolvedFloor = floor === '__other__' ? (floorOther.trim() || 'Main') : floor;
    const cfg: AnchorConfig = {
      deviceId: id,
      label: label.trim() || id,
      position: { x: position.x, y: position.y, z: position.z },
      floor: resolvedFloor,
    };
    const rp = parseOptionalFloat(refPower);
    const pl = parseOptionalFloat(pathLossExp);
    const ag = parseOptionalFloat(antennaGainDbi);
    const tw = parseOptionalFloat(trustWeight);
    if (rp !== undefined) cfg.refPower = rp;
    if (pl !== undefined) cfg.pathLossExp = pl;
    if (ag !== undefined) cfg.antennaGainDbi = ag;
    if (tw !== undefined) cfg.trustWeight = Math.max(0, Math.min(1, tw));
    onSave(cfg);
  }, [deviceId, label, floor, floorOther, position, refPower, pathLossExp, antennaGainDbi, trustWeight, onSave]);

  const footer = (
    <>
      <button className="btn btn-primary" onClick={handlePick}>
        {placingMode ? '✕ Cancel Placement' : '\u{1F4CD} Pick From Scene'}
      </button>
      <button className="btn btn-success" onClick={handleSave}>
        &#10003; Save Anchor
      </button>
      <button className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
    </>
  );

  return (
    <FormPanel
      open={open}
      title={editAnchor ? 'Edit Anchor' : 'Add Anchor'}
      onClose={onClose}
      footer={footer}
    >
      <AccordionSection title="Identity" defaultOpen>
        <div className="field-group">
          <label className="field-label">Device ID (Bermuda address or HA device_id)</label>
          <input
            type="text"
            className="field-input"
            placeholder="e0:72:a1:d5:0f:92"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
          />
        </div>
        <div className="field-group">
          <label className="field-label">Label (display name)</label>
          <input
            type="text"
            className="field-input"
            placeholder="Master Bedroom Anchor"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="field-group">
          <label className="field-label">Floor</label>
          <select
            className="field-input"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
          >
            {FLOORS.map((f) => <option key={f} value={f}>{f}</option>)}
            <option value="__other__">Other…</option>
          </select>
          {floor === '__other__' && (
            <input
              type="text"
              className="field-input"
              placeholder="Custom floor name"
              value={floorOther}
              onChange={(e) => setFloorOther(e.target.value)}
              style={{ marginTop: 4 }}
            />
          )}
          <span className="field-label" style={{ opacity: 0.5, fontSize: 11, marginTop: 2 }}>
            Must match HA's <code>sensor.&lt;phone&gt;_floor</code> state.
          </span>
        </div>
      </AccordionSection>

      <AccordionSection title="Position" defaultOpen>
        <div className={`placement-hint${open ? ' visible' : ''}`}>
          Click on the model after pressing "Pick From Scene". Click upstairs
          floor for upstairs y.
        </div>
        {([
          { label: 'X', color: '#f87171', axis: 'x' as const, range: [-30, 30] as [number, number] },
          { label: 'Z', color: '#4ade80', axis: 'y' as const, range: [-2, 10] as [number, number] },
          { label: 'Y', color: '#38bdf8', axis: 'z' as const, range: [-30, 30] as [number, number] },
        ]).map(({ label: lbl, color: axColor, axis, range }) => (
          <div key={axis} className="pos-grid">
            <span className="pos-axis" style={{ color: axColor }}>{lbl}</span>
            <input
              type="range"
              className="pos-slider"
              min={range[0]}
              max={range[1]}
              step={0.05}
              value={position[axis]}
              onChange={(e) => handlePosChange(axis, parseFloat(e.target.value))}
            />
            <input
              type="number"
              className="pos-num"
              step={0.05}
              value={position[axis]}
              onChange={(e) => handlePosChange(axis, parseFloat(e.target.value) || 0)}
            />
          </div>
        ))}
      </AccordionSection>

      <AccordionSection title="Calibration (advanced)">
        <div className="field-group">
          <label className="field-label">Reference power (dBm @ 1m)</label>
          <input
            type="number"
            className="field-input"
            placeholder={String(ANCHOR_CALIBRATION_DEFAULTS.refPower)}
            value={refPower}
            step={1}
            onChange={(e) => setRefPower(e.target.value)}
          />
          <span className="field-label" style={{ opacity: 0.5, fontSize: 11, marginTop: 2 }}>
            Default {ANCHOR_CALIBRATION_DEFAULTS.refPower}. Used by Phase 4 path-loss model.
          </span>
        </div>
        <div className="field-group">
          <label className="field-label">Path-loss exponent (n)</label>
          <input
            type="number"
            className="field-input"
            placeholder={String(ANCHOR_CALIBRATION_DEFAULTS.pathLossExp)}
            value={pathLossExp}
            step={0.1}
            onChange={(e) => setPathLossExp(e.target.value)}
          />
          <span className="field-label" style={{ opacity: 0.5, fontSize: 11, marginTop: 2 }}>
            Default {ANCHOR_CALIBRATION_DEFAULTS.pathLossExp}. Open space 2.0, dense walls 4.0.
          </span>
        </div>
        <div className="field-group">
          <label className="field-label">Antenna gain offset (dBi)</label>
          <input
            type="number"
            className="field-input"
            placeholder={String(ANCHOR_CALIBRATION_DEFAULTS.antennaGainDbi)}
            value={antennaGainDbi}
            step={0.5}
            onChange={(e) => setAntennaGainDbi(e.target.value)}
          />
          <span className="field-label" style={{ opacity: 0.5, fontSize: 11, marginTop: 2 }}>
            Default {ANCHOR_CALIBRATION_DEFAULTS.antennaGainDbi}. Reserved for future use.
          </span>
        </div>
        <div className="field-group">
          <label className="field-label">Trust weight (0.0 – 1.0)</label>
          <input
            type="number"
            className="field-input"
            placeholder={String(ANCHOR_CALIBRATION_DEFAULTS.trustWeight)}
            value={trustWeight}
            min={0}
            max={1}
            step={0.05}
            onChange={(e) => setTrustWeight(e.target.value)}
          />
          <span className="field-label" style={{ opacity: 0.5, fontSize: 11, marginTop: 2 }}>
            Default {ANCHOR_CALIBRATION_DEFAULTS.trustWeight}. Multiplies the solver weight for this anchor.
          </span>
        </div>
      </AccordionSection>
    </FormPanel>
  );
}
