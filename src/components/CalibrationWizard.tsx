import { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  AnchorConfig,
  CalibrationFingerprint,
  LightPosition,
  TrackerConfig,
} from '../types';
import {
  addFingerprint,
  deleteFingerprint,
  exportFingerprintsJSON,
  generateFingerprintId,
  getFingerprints,
  importFingerprintsJSON,
} from '../services/calibrationStore';
import './CalibrationWizard.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Configured trackers. The user picks which one is producing the BLE
   *  signal at capture time (typically the phone they're holding). */
  trackers: TrackerConfig[];
  /** Currently configured anchors — used to filter the captured fingerprint
   *  to scanners we actually care about. */
  anchors: AnchorConfig[];
  /** Enter pick mode on the canvas, resolve with the picked point. The
   *  Dashboard owns scene access — this prop lets the wizard request a pick
   *  without holding a Babylon reference. */
  onRequestPick: () => Promise<LightPosition | null>;
  /** Read the latest per-anchor readings for a tracker. Returns null if the
   *  tracker hasn't been seen yet. */
  onCaptureSnapshot: (trackerEntityId: string) => CaptureSnapshot | null;
}

export interface CaptureSnapshot {
  /** Per-anchor RSSI in dBm. Keyed by anchor deviceId (lowercase). */
  rssiByAnchor: Record<string, number>;
  /** Per-anchor distance in meters. Keyed by anchor deviceId. */
  distanceByAnchor: Record<string, number>;
}

type Step = 'pick' | 'confirm' | 'done';

function floorFromY(y: number): string {
  return y > 2.5 ? 'Upper' : 'Main';
}

export default function CalibrationWizard({
  open,
  onClose,
  trackers,
  anchors,
  onRequestPick,
  onCaptureSnapshot,
}: Props) {
  const [step, setStep] = useState<Step>('pick');
  const [position, setPosition] = useState<LightPosition | null>(null);
  const [trackerEntityId, setTrackerEntityId] = useState<string>('');
  const [label, setLabel] = useState<string>('');
  const [snapshot, setSnapshot] = useState<CaptureSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number>(() => getFingerprints().length);
  const [busy, setBusy] = useState(false);

  // Initialize tracker selection when the wizard opens.
  useEffect(() => {
    if (!open) return;
    if (trackers.length > 0 && !trackerEntityId) {
      setTrackerEntityId(trackers[0].entityId);
    }
    setSavedCount(getFingerprints().length);
  }, [open, trackers, trackerEntityId]);

  const reset = useCallback(() => {
    setStep('pick');
    setPosition(null);
    setLabel('');
    setSnapshot(null);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handlePick = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const point = await onRequestPick();
      if (!point) {
        setError('Pick cancelled. Click on the model to choose a spot.');
        return;
      }
      setPosition(point);
      setStep('confirm');
    } catch (err) {
      console.warn('[3Dash][calibration] pick failed:', err);
      setError('Could not capture the picked point.');
    } finally {
      setBusy(false);
    }
  }, [onRequestPick]);

  const handleConfirm = useCallback(() => {
    if (!position || !trackerEntityId) return;
    setError(null);
    const snap = onCaptureSnapshot(trackerEntityId);
    if (!snap || Object.keys(snap.rssiByAnchor).length === 0) {
      setError(
        'No anchors are seeing this tracker right now. Wait a few seconds, '
        + 'check that the phone is unlocked, and try again.',
      );
      return;
    }
    setSnapshot(snap);
    // Restrict to currently-configured anchors so deleted scanners don't
    // bloat the fingerprint.
    const known = new Set(anchors.map((a) => a.deviceId.toLowerCase()));
    const filteredRssi: Record<string, number> = {};
    const filteredDist: Record<string, number> = {};
    for (const [id, v] of Object.entries(snap.rssiByAnchor)) {
      if (known.has(id.toLowerCase())) filteredRssi[id.toLowerCase()] = v;
    }
    for (const [id, v] of Object.entries(snap.distanceByAnchor)) {
      if (known.has(id.toLowerCase())) filteredDist[id.toLowerCase()] = v;
    }
    const fp: CalibrationFingerprint = {
      id: generateFingerprintId(),
      position,
      floor: floorFromY(position.y),
      trackerEntityId,
      rssiByAnchor: filteredRssi,
      distanceByAnchor: filteredDist,
      timestamp: Date.now(),
      label: label.trim() || undefined,
    };
    const next = addFingerprint(fp);
    setSavedCount(next);
    setStep('done');
  }, [position, trackerEntityId, label, anchors, onCaptureSnapshot]);

  const fingerprints = useMemo(
    () => (open ? getFingerprints() : []),
    [open, savedCount],
  );

  // Phase 7: export/import flow for backing up calibration data so a
  // container redeploy or browser-storage wipe doesn't lose it.
  const handleExport = useCallback(() => {
    try {
      const json = exportFingerprintsJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const a = document.createElement('a');
      a.href = url;
      a.download = `3dash-calibration-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('[3Dash][calibration] export failed:', err);
      setError('Export failed — see console for details.');
    }
  }, []);

  const handleImportClick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const mode = window.confirm(
          'Merge with existing fingerprints? Click OK to merge, Cancel to replace.',
        )
          ? 'merge'
          : 'replace';
        const total = importFingerprintsJSON(text, mode);
        setSavedCount(total);
        setError(null);
      } catch (err) {
        console.warn('[3Dash][calibration] import failed:', err);
        setError(
          err instanceof Error
            ? `Import failed: ${err.message}`
            : 'Import failed — see console for details.',
        );
      }
    };
    input.click();
  }, []);

  const seenAnchorCount = useMemo(() => {
    if (!snapshot) return 0;
    const known = new Set(anchors.map((a) => a.deviceId.toLowerCase()));
    return Object.keys(snapshot.rssiByAnchor).filter((id) => known.has(id.toLowerCase())).length;
  }, [snapshot, anchors]);

  if (!open) return null;

  return (
    <div className="cal-wizard-backdrop" onClick={handleClose}>
      <div className="cal-wizard" onClick={(e) => e.stopPropagation()}>
        <div className="cal-wizard-header">
          <div className="cal-wizard-title">Calibrate Position</div>
          <button
            className="cal-wizard-close"
            onClick={handleClose}
            aria-label="Close wizard"
          >
            &times;
          </button>
        </div>

        <div className="cal-wizard-stepper">
          <div className={`cal-wizard-step${step === 'pick' ? ' active' : ''}`}>1. Pick spot</div>
          <div className={`cal-wizard-step${step === 'confirm' ? ' active' : ''}`}>2. Confirm</div>
          <div className={`cal-wizard-step${step === 'done' ? ' active' : ''}`}>3. Save</div>
        </div>

        {error && <div className="cal-wizard-error">{error}</div>}

        {step === 'pick' && (
          <div className="cal-wizard-body">
            <p className="cal-wizard-prompt">
              Stand at a distinctive spot in your home (couch, kitchen island,
              bedroom doorway). Then click below — the 3D scene will let you
              tap your current location on the model.
            </p>
            <div className="cal-wizard-row">
              <label className="cal-wizard-label">
                Which phone is producing the signal?
              </label>
              <select
                className="cal-wizard-input"
                value={trackerEntityId}
                onChange={(e) => setTrackerEntityId(e.target.value)}
                disabled={trackers.length === 0}
              >
                {trackers.length === 0 ? (
                  <option value="">No trackers configured</option>
                ) : (
                  trackers.map((t) => (
                    <option key={t.entityId} value={t.entityId}>
                      {t.label || t.entityId}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="cal-wizard-row">
              <label className="cal-wizard-label">
                Label (optional)
              </label>
              <input
                type="text"
                className="cal-wizard-input"
                placeholder="e.g. Living Room couch"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="cal-wizard-footer">
              <button
                className="cal-wizard-btn primary"
                onClick={handlePick}
                disabled={busy || !trackerEntityId}
              >
                {busy ? 'Tap the model…' : 'Pick from scene'}
              </button>
              <button className="cal-wizard-btn ghost" onClick={handleClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === 'confirm' && position && (
          <div className="cal-wizard-body">
            <p className="cal-wizard-prompt">
              You're standing at
              {' '}
              <strong>
                ({position.x.toFixed(2)}, {position.y.toFixed(2)}, {position.z.toFixed(2)})
              </strong>
              {' '}
              on the <strong>{floorFromY(position.y)}</strong> floor.
              When you tap Confirm, we'll snapshot what every anchor sees from
              there.
            </p>
            <div className="cal-wizard-footer">
              <button className="cal-wizard-btn primary" onClick={handleConfirm}>
                Confirm &amp; record
              </button>
              <button className="cal-wizard-btn ghost" onClick={() => setStep('pick')}>
                Re-pick
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="cal-wizard-body">
            <p className="cal-wizard-prompt cal-wizard-success">
              {'✓'} Captured fingerprint from {seenAnchorCount} anchor
              {seenAnchorCount === 1 ? '' : 's'}. Total fingerprints:
              {' '}<strong>{savedCount}</strong>.
            </p>
            {savedCount < 5 && (
              <p className="cal-wizard-hint">
                Add at least 5 fingerprints to unlock k-NN positioning (Phase 4).
                Spread them across the rooms where you spend most of your time.
              </p>
            )}
            <div className="cal-wizard-footer">
              <button
                className="cal-wizard-btn primary"
                onClick={reset}
              >
                Add another
              </button>
              <button className="cal-wizard-btn ghost" onClick={handleClose}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* Always show the live fingerprint list at the bottom — lets the user
            see what's already captured and delete mistakes without leaving
            the wizard. */}
        <div className="cal-wizard-list">
          <div className="cal-wizard-list-header">
            <span>Fingerprints ({fingerprints.length})</span>
            <span className="cal-wizard-list-actions">
              <button
                className="cal-wizard-list-btn"
                onClick={handleExport}
                disabled={fingerprints.length === 0}
                title="Download all fingerprints as JSON"
              >
                Export
              </button>
              <button
                className="cal-wizard-list-btn"
                onClick={handleImportClick}
                title="Restore fingerprints from a previous export"
              >
                Import
              </button>
            </span>
          </div>
          {fingerprints.length === 0 ? (
            <div className="cal-wizard-list-empty">
              None yet — add your first fingerprint above.
            </div>
          ) : (
            <div className="cal-wizard-list-body">
              {fingerprints.map((fp) => (
                <div key={fp.id} className="cal-wizard-list-row">
                  <div className="cal-wizard-list-info">
                    <div className="cal-wizard-list-label">
                      {fp.label || `(${fp.position.x.toFixed(1)}, ${fp.position.y.toFixed(1)}, ${fp.position.z.toFixed(1)})`}
                    </div>
                    <div className="cal-wizard-list-meta">
                      {fp.floor} · {Object.keys(fp.rssiByAnchor).length} anchors
                      {' · '}
                      {new Date(fp.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <button
                    className="cal-wizard-list-del"
                    onClick={() => {
                      deleteFingerprint(fp.id);
                      setSavedCount(getFingerprints().length);
                    }}
                    title="Delete"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
