import { useState, useEffect, useCallback, useRef } from 'react';
import type { TrackerConfig, LightPosition } from '../types';
import { FormPanel, AccordionSection } from './FormPanel';
import EntityPicker, { type HAEntityOption } from './EntityPicker';
import { normalizeAreaKey } from '../babylon/TrackerMeshFactory';

/**
 * Row in the per-room position editor. We track `pendingAreaId` separately
 * from `areaId` (the normalized key actually stored in cfg.areaPositions)
 * so the user can type freely without keys being eaten on every keystroke.
 */
interface AreaRow {
  areaId: string; // raw user input — normalized on save
  pos: LightPosition;
}

interface Props {
  open: boolean;
  editTracker: TrackerConfig | null;
  /** Picked-from-scene position for the "default" position OR for the row
   *  identified by `pickingRowIdx`. When pickingRowIdx is null, this maps
   *  to the tracker's default position. */
  position: LightPosition;
  onPositionChange: (pos: LightPosition) => void;
  onSave: (cfg: TrackerConfig) => void;
  onClose: () => void;
  /** Begin pick-from-scene mode. `rowIdx` = null → default position;
   *  otherwise → that areaPositions row gets the picked point. */
  onEnterPickMode: (rowIdx: number | null) => void;
  onExitPickMode: () => void;
  /**
   *  Which target is currently being picked:
   *    -1   → idle (not in pick mode)
   *    null → the tracker's default position (writes via onPositionChange)
   *    >= 0 → the areaPositions row at that index
   */
  pickingRowIdx: number | null;
  /** True while waiting for a click on the scene. */
  placingMode: boolean;
  haEntities?: HAEntityOption[];
}

const DEFAULT_COLOR = '#4ade80';
const DEFAULT_DIAMETER = 0.3;
const DEFAULT_GLOW = 1;

export default function TrackerForm({
  open,
  editTracker,
  position,
  onPositionChange,
  onSave,
  onClose,
  onEnterPickMode,
  onExitPickMode,
  pickingRowIdx,
  placingMode,
  haEntities = [],
}: Props) {
  const [entityId, setEntityId] = useState('');
  const [areaEntityId, setAreaEntityId] = useState('');
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [diameter, setDiameter] = useState(DEFAULT_DIAMETER);
  const [glow, setGlow] = useState(DEFAULT_GLOW);
  const [hideWhenAway, setHideWhenAway] = useState(true);
  const [areaRows, setAreaRows] = useState<AreaRow[]>([]);

  // Reset / populate form when the panel opens
  useEffect(() => {
    if (!open) return;
    if (editTracker) {
      setEntityId(editTracker.entityId);
      setAreaEntityId(editTracker.areaEntityId ?? '');
      setLabel(editTracker.label || '');
      setColor(editTracker.color ?? DEFAULT_COLOR);
      setDiameter(editTracker.diameter ?? DEFAULT_DIAMETER);
      setGlow(editTracker.glow ?? DEFAULT_GLOW);
      setHideWhenAway(editTracker.hideWhenAway ?? true);
      setAreaRows(
        Object.entries(editTracker.areaPositions || {}).map(([k, v]) => ({
          areaId: k,
          pos: { x: v.x, y: v.y, z: v.z },
        })),
      );
    } else {
      setEntityId('');
      setAreaEntityId('');
      setLabel('');
      setColor(DEFAULT_COLOR);
      setDiameter(DEFAULT_DIAMETER);
      setGlow(DEFAULT_GLOW);
      setHideWhenAway(true);
      setAreaRows([]);
    }
  }, [editTracker, open]);

  // Track previous placingMode so we can detect the "click happened" transition
  // (placingMode goes true → false). When that happens, if we were targeting a
  // row (pickingRowIdx >= 0), copy the freshly-picked position into that row.
  // Default-position picks (pickingRowIdx === null) flow directly via
  // onPositionChange and don't need a fan-out here.
  const prevPlacingRef = useRef(placingMode);
  useEffect(() => {
    const prev = prevPlacingRef.current;
    prevPlacingRef.current = placingMode;
    if (!prev || placingMode) return; // only act on true → false edge
    if (pickingRowIdx === null || pickingRowIdx < 0) return;
    const rowIdx = pickingRowIdx;
    setAreaRows((prevRows) =>
      prevRows.map((r, i) => (i === rowIdx ? { ...r, pos: { ...position } } : r)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placingMode]);

  const handlePosChange = useCallback(
    (axis: 'x' | 'y' | 'z', value: number) => {
      onPositionChange({ ...position, [axis]: parseFloat(value.toFixed(3)) });
    },
    [position, onPositionChange],
  );

  const updateRow = useCallback(
    (idx: number, update: Partial<AreaRow> | { pos: Partial<LightPosition> }) => {
      setAreaRows((prev) =>
        prev.map((r, i) => {
          if (i !== idx) return r;
          if ('pos' in update && typeof update.pos === 'object') {
            return { ...r, pos: { ...r.pos, ...(update.pos as Partial<LightPosition>) } };
          }
          return { ...r, ...(update as Partial<AreaRow>) };
        }),
      );
    },
    [],
  );

  const addRow = useCallback(() => {
    setAreaRows((prev) => [
      ...prev,
      { areaId: '', pos: { x: position.x, y: position.y, z: position.z } },
    ]);
  }, [position]);

  const removeRow = useCallback((idx: number) => {
    setAreaRows((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handlePickDefault = useCallback(() => {
    if (placingMode) onExitPickMode();
    else onEnterPickMode(null);
  }, [placingMode, onEnterPickMode, onExitPickMode]);

  const handlePickRow = useCallback(
    (idx: number) => {
      if (placingMode) onExitPickMode();
      else onEnterPickMode(idx);
    },
    [placingMode, onEnterPickMode, onExitPickMode],
  );

  const handleSave = useCallback(() => {
    const id = entityId.trim();
    if (!id) {
      alert('Entity ID is required');
      return;
    }
    // Build areaPositions: normalize keys, drop empty keys, last-write-wins
    // when two rows normalize to the same key (warn in console).
    const areaPositions: Record<string, LightPosition> = {};
    for (const row of areaRows) {
      const key = normalizeAreaKey(row.areaId);
      if (!key) continue;
      if (areaPositions[key]) {
        console.warn(`[TrackerForm] duplicate area key "${key}" — last value wins`);
      }
      areaPositions[key] = { x: row.pos.x, y: row.pos.y, z: row.pos.z };
    }
    const cfg: TrackerConfig = {
      entityId: id,
      areaEntityId: areaEntityId.trim() || undefined,
      label: label.trim() || id.split('.')[1] || id,
      color,
      diameter,
      glow,
      position: { x: position.x, y: position.y, z: position.z },
      areaPositions,
      hideWhenAway,
    };
    onSave(cfg);
  }, [entityId, areaEntityId, label, color, diameter, glow, position, areaRows, hideWhenAway, onSave]);

  const footer = (
    <>
      <button
        className="btn btn-primary"
        onClick={handlePickDefault}
      >
        {placingMode && pickingRowIdx === null
          ? '✕ Cancel Placement'
          : '\u{1F4CD} Pick Default From Scene'}
      </button>
      <button className="btn btn-success" onClick={handleSave}>
        &#10003; Save Tracker
      </button>
      <button className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
    </>
  );

  return (
    <FormPanel
      open={open}
      title={editTracker ? 'Edit Tracker' : 'Add Tracker'}
      onClose={onClose}
      footer={footer}
    >
      <AccordionSection title="Identity" defaultOpen>
        <div className="field-group">
          <label className="field-label">Device Tracker Entity ID</label>
          <EntityPicker
            value={entityId}
            onChange={setEntityId}
            onSelect={(e) => { if (!label.trim() && e.friendly_name) setLabel(e.friendly_name); }}
            placeholder="device_tracker.daniel_s_iphone"
            entities={haEntities}
            className="field-input"
          />
        </div>
        <div className="field-group">
          <label className="field-label">Area Sensor Entity ID</label>
          <EntityPicker
            value={areaEntityId}
            onChange={setAreaEntityId}
            placeholder="sensor.daniel_s_iphone_area"
            entities={haEntities}
            className="field-input"
          />
          <span className="field-label" style={{ opacity: 0.5, fontSize: 11, marginTop: 2 }}>
            HA sensor that reports the current area as a string
          </span>
        </div>
        <div className="field-group">
          <label className="field-label">Label (display name)</label>
          <input
            type="text"
            className="field-input"
            placeholder="Daniel's iPhone"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="field-group">
          <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={hideWhenAway}
              onChange={(e) => setHideWhenAway(e.target.checked)}
            />
            Hide when away (device_tracker = not_home)
          </label>
        </div>
      </AccordionSection>

      <AccordionSection title="Appearance">
        <div className="field-group">
          <label className="field-label">Color</label>
          <input
            type="color"
            className="field-input"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ height: 32, padding: 2 }}
          />
        </div>
        <div className="field-group">
          <label className="field-label">Diameter ({diameter.toFixed(2)})</label>
          <input
            type="range"
            className="pos-slider"
            min={0.05}
            max={2}
            step={0.05}
            value={diameter}
            onChange={(e) => setDiameter(parseFloat(e.target.value))}
          />
        </div>
        <div className="field-group">
          <label className="field-label">Glow ({glow.toFixed(2)})</label>
          <input
            type="range"
            className="pos-slider"
            min={0}
            max={10}
            step={0.1}
            value={glow}
            onChange={(e) => setGlow(parseFloat(e.target.value))}
          />
        </div>
      </AccordionSection>

      <AccordionSection title="Per-Room Positions" defaultOpen>
        <div className="field-group">
          <span className="field-label" style={{ opacity: 0.6, fontSize: 11 }}>
            Area key is normalized on save (e.g. "Dining Room" → "dining_room").
            Y coordinate is not clamped — pick on the upstairs floor for upstairs y.
          </span>
        </div>
        {areaRows.map((row, idx) => (
          <div
            key={idx}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 8,
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="field-label" style={{ fontWeight: 'bold' }}>
                Room {idx + 1}
              </span>
              <button
                className="btn btn-ghost"
                style={{ padding: '2px 6px', fontSize: 11 }}
                onClick={() => removeRow(idx)}
                title="Delete row"
              >
                &#10005;
              </button>
            </div>
            <div className="field-group">
              <label className="field-label">Area ID / Name</label>
              <input
                type="text"
                className="field-input"
                placeholder="dining_room or Dining Room"
                value={row.areaId}
                onChange={(e) => updateRow(idx, { areaId: e.target.value })}
              />
              {row.areaId && normalizeAreaKey(row.areaId) !== row.areaId && (
                <span className="field-label" style={{ opacity: 0.5, fontSize: 11, marginTop: 2 }}>
                  Stored as: <code>{normalizeAreaKey(row.areaId)}</code>
                </span>
              )}
            </div>
            <span className="field-label" style={{ marginTop: 4 }}>Position</span>
            {([
              { label: 'X', color: '#f87171', key: 'x' as const, range: [-30, 30] as [number, number] },
              { label: 'Z', color: '#4ade80', key: 'y' as const, range: [-2, 10] as [number, number] },
              { label: 'Y', color: '#38bdf8', key: 'z' as const, range: [-30, 30] as [number, number] },
            ]).map(({ label: axLabel, color: axColor, key, range }) => (
              <div key={`row-${idx}-${key}`} className="pos-grid">
                <span className="pos-axis" style={{ color: axColor }}>{axLabel}</span>
                <input
                  type="range"
                  className="pos-slider"
                  min={range[0]}
                  max={range[1]}
                  step={0.05}
                  value={row.pos[key]}
                  onChange={(e) => updateRow(idx, { pos: { [key]: parseFloat(e.target.value) } })}
                />
                <input
                  type="number"
                  className="pos-num"
                  step={0.05}
                  value={row.pos[key]}
                  onChange={(e) => updateRow(idx, { pos: { [key]: parseFloat(e.target.value) || 0 } })}
                />
              </div>
            ))}
            <button
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 4, fontSize: 11 }}
              onClick={() => handlePickRow(idx)}
            >
              {placingMode && pickingRowIdx === idx
                ? '✕ Cancel Pick'
                : '\u{1F4CD} Pick This Row From Scene'}
            </button>
          </div>
        ))}
        <button
          className="btn btn-ghost"
          style={{ width: '100%' }}
          onClick={addRow}
        >
          + Add Room
        </button>
      </AccordionSection>

      <AccordionSection title="Default Position" defaultOpen>
        <div className={`placement-hint${open ? ' visible' : ''}`}>
          Fallback position when no area mapping matches.<br />
          Click the model after pressing "Pick Default From Scene".
        </div>
        {([
          { label: 'X', color: '#f87171', babylonAxis: 'x' as const, range: [-30, 30] as [number, number] },
          { label: 'Z', color: '#4ade80', babylonAxis: 'y' as const, range: [-2, 10] as [number, number] },
          { label: 'Y', color: '#38bdf8', babylonAxis: 'z' as const, range: [-30, 30] as [number, number] },
        ]).map(({ label: lbl, color: axColor, babylonAxis, range }) => (
          <div key={babylonAxis} className="pos-grid">
            <span className="pos-axis" style={{ color: axColor }}>{lbl}</span>
            <input
              type="range"
              className="pos-slider"
              min={range[0]}
              max={range[1]}
              step={0.05}
              value={position[babylonAxis]}
              onChange={(e) => handlePosChange(babylonAxis, parseFloat(e.target.value))}
            />
            <input
              type="number"
              className="pos-num"
              step={0.05}
              value={position[babylonAxis]}
              onChange={(e) => handlePosChange(babylonAxis, parseFloat(e.target.value) || 0)}
            />
          </div>
        ))}
      </AccordionSection>
    </FormPanel>
  );
}
