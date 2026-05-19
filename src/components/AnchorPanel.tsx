import { useMemo, useState, useEffect } from 'react';
import type { AnchorConfig } from '../types';
import { getFingerprints } from '../services/calibrationStore';
import './AnchorPanel.css';

interface Props {
  open: boolean;
  onClose: () => void;
  anchors: AnchorConfig[];
  /** Bermuda scanner addresses that produced any advert in the last poll. */
  liveDeviceIds: Set<string>;
  /** Anchor currently in pick-mode (highlighted, "click on the model"). */
  placingDeviceId: string | null;
  onPlace: (deviceId: string) => void;
  onCancelPlace: () => void;
  onToggleHidden: (deviceId: string) => void;
  onCalibrate?: () => void;
  onDiagnostics?: () => void;
}

interface FloorGroup {
  floor: string;
  anchors: AnchorConfig[];
}

function groupByFloor(anchors: AnchorConfig[]): FloorGroup[] {
  const groups = new Map<string, AnchorConfig[]>();
  for (const a of anchors) {
    const f = a.floor || 'Unassigned';
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f)!.push(a);
  }
  const order = ['Main', 'Upper'];
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
  return sortedKeys.map((floor) => ({ floor, anchors: groups.get(floor)! }));
}

export default function AnchorPanel({
  open,
  onClose,
  anchors,
  liveDeviceIds,
  placingDeviceId,
  onPlace,
  onCancelPlace,
  onToggleHidden,
  onCalibrate,
  onDiagnostics,
}: Props) {
  const groups = useMemo(() => groupByFloor(anchors), [anchors]);
  // Phase 3: live fingerprint count for the footer label. We re-read on each
  // open since the wizard mutates localStorage independently.
  const [fingerprintCount, setFingerprintCount] = useState(0);
  useEffect(() => {
    if (open) setFingerprintCount(getFingerprints().length);
  }, [open]);
  // Phase 1 back-compat: anchors stored before this phase don't have
  // `placed`. Treat undefined as "placed" since users had to set a position
  // via /editor to get them in there. Only explicit `placed === false`
  // (set by the new auto-discovery in Dashboard) means "needs placement".
  const placedCount = useMemo(
    () => anchors.filter((a) => a.placed !== false).length,
    [anchors],
  );
  const total = anchors.length;
  const placedPct = total > 0 ? Math.round((placedCount / total) * 100) : 0;

  if (!open) return null;

  return (
    <div className="anchor-panel">
      <div className="anchor-panel-header">
        <div className="anchor-panel-title">
          Anchors <span className="anchor-panel-count">({total})</span>
        </div>
        <button
          className="anchor-panel-close"
          onClick={onClose}
          title="Close"
          aria-label="Close anchor panel"
        >
          &times;
        </button>
      </div>

      <div className="anchor-panel-progress">
        <div className="anchor-panel-progress-bar">
          <div
            className="anchor-panel-progress-fill"
            style={{ width: `${placedPct}%` }}
          />
        </div>
        <div className="anchor-panel-progress-label">
          {placedCount} of {total} placed
        </div>
      </div>

      <div className="anchor-panel-body">
        {total === 0 ? (
          <div className="anchor-panel-empty">
            No anchors discovered. Make sure Bermuda is running and at least
            one BLE proxy is online.
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.floor} className="anchor-panel-group">
              <div className="anchor-panel-group-header">
                {g.floor} ({g.anchors.length})
              </div>
              {g.anchors.map((a) => {
                const isPlacing = placingDeviceId === a.deviceId;
                const isLive = liveDeviceIds.has(a.deviceId.toLowerCase());
                const isPlaced = a.placed !== false;
                const isHidden = a.hidden === true;
                return (
                  <div
                    key={a.deviceId}
                    className={
                      'anchor-row'
                      + (isPlacing ? ' placing' : '')
                      + (isHidden ? ' hidden' : '')
                    }
                  >
                    <div
                      className={'anchor-row-status' + (isLive ? ' live' : '')}
                      title={isLive ? 'Live (advert in last poll)' : 'No recent advert'}
                    />
                    <div className="anchor-row-info">
                      <div className="anchor-row-label" title={a.deviceId}>
                        {a.label || a.deviceId}
                      </div>
                      <div className="anchor-row-meta">
                        {isPlaced
                          ? `(${a.position.x.toFixed(1)}, ${a.position.y.toFixed(1)}, ${a.position.z.toFixed(1)})`
                          : 'not placed'}
                      </div>
                    </div>
                    <button
                      className={'anchor-row-place' + (isPlacing ? ' active' : '')}
                      onClick={() =>
                        isPlacing ? onCancelPlace() : onPlace(a.deviceId)
                      }
                      title={isPlacing ? 'Cancel placement' : 'Click to place this anchor'}
                    >
                      {isPlacing ? 'Cancel' : isPlaced ? 'Re-place' : 'Place'}
                    </button>
                    <button
                      className="anchor-row-hide"
                      onClick={() => onToggleHidden(a.deviceId)}
                      title={isHidden ? 'Show in solver' : 'Hide from solver'}
                    >
                      {isHidden ? '\u{1F441}' : '\u{1F441}‍\u{1F5E8}'}
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="anchor-panel-footer">
        <button
          className="anchor-panel-action"
          onClick={onCalibrate}
          disabled={!onCalibrate}
          title="Capture a calibration fingerprint at a known spot"
        >
          Calibrate
          {fingerprintCount > 0 && (
            <span className="anchor-panel-action-badge">{fingerprintCount}</span>
          )}
        </button>
        <button
          className="anchor-panel-action"
          onClick={onDiagnostics}
          disabled={!onDiagnostics}
          title="Coming in Phase 5 — diagnostics overlay"
        >
          Diagnostics
        </button>
      </div>
    </div>
  );
}
