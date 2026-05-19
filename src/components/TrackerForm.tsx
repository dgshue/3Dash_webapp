import { useState, useEffect, useCallback } from 'react';
import type { TrackerConfig } from '../types';
import { FormPanel, AccordionSection } from './FormPanel';
import EntityPicker, { type HAEntityOption } from './EntityPicker';

/**
 * Tracker editor — identity + appearance only. Positions are driven by the
 * live BLE solver (Bermuda distances → k-NN / trilateration / centroid /
 * area-snap) in Dashboard.tsx, so the user never has to place an orb by
 * hand. The form preserves any `position` / `areaPositions` on `editTracker`
 * but doesn't expose them — those legacy fields stay in the saved config so
 * a future fallback path can read them.
 */

interface Props {
  open: boolean;
  editTracker: TrackerConfig | null;
  onSave: (cfg: TrackerConfig) => void;
  onClose: () => void;
  haEntities?: HAEntityOption[];
}

const DEFAULT_COLOR = '#4ade80';
const DEFAULT_DIAMETER = 0.3;
const DEFAULT_GLOW = 1;

export default function TrackerForm({
  open,
  editTracker,
  onSave,
  onClose,
  haEntities = [],
}: Props) {
  const [entityId, setEntityId] = useState('');
  const [areaEntityId, setAreaEntityId] = useState('');
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [diameter, setDiameter] = useState(DEFAULT_DIAMETER);
  const [glow, setGlow] = useState(DEFAULT_GLOW);
  const [hideWhenAway, setHideWhenAway] = useState(true);

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
    } else {
      setEntityId('');
      setAreaEntityId('');
      setLabel('');
      setColor(DEFAULT_COLOR);
      setDiameter(DEFAULT_DIAMETER);
      setGlow(DEFAULT_GLOW);
      setHideWhenAway(true);
    }
  }, [editTracker, open]);

  const handleSave = useCallback(() => {
    const id = entityId.trim();
    if (!id) {
      alert('Entity ID is required');
      return;
    }
    // Preserve any legacy position / areaPositions stored on the editTracker
    // — we just don't surface them in the UI. Brand-new trackers get sane
    // defaults; the BLE solver will move the orb to a real position once
    // Bermuda has distance data.
    const cfg: TrackerConfig = {
      entityId: id,
      areaEntityId: areaEntityId.trim() || undefined,
      label: label.trim() || id.split('.')[1] || id,
      color,
      diameter,
      glow,
      position: editTracker?.position || { x: 0, y: 1, z: 0 },
      areaPositions: editTracker?.areaPositions || {},
      hideWhenAway,
    };
    onSave(cfg);
  }, [entityId, areaEntityId, label, color, diameter, glow, hideWhenAway, editTracker, onSave]);

  const footer = (
    <>
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
            HA sensor that reports the current area as a string. Optional — Bermuda fills this in automatically.
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

      <div style={{
        margin: '10px 16px 16px',
        padding: '8px 12px',
        background: 'rgba(34, 211, 238, 0.08)',
        border: '1px solid rgba(34, 211, 238, 0.25)',
        borderRadius: 6,
        color: '#94a3b8',
        fontSize: 12,
        lineHeight: 1.45,
      }}>
        Position is driven by the live BLE solver — Bermuda distances feed
        k-NN / trilateration / centroid / area-snap automatically. No
        manual placement needed.
      </div>
    </FormPanel>
  );
}
