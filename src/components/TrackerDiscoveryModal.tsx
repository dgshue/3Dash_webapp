import { useEffect, useState, useCallback } from 'react';
import type { TrackerConfig, HAState } from '../types';
import { HAConnection } from '../services/haWebSocket';
import { getSetting } from '../services/settingsStore';
import './BermudaDiscoveryModal.css';

interface Props {
  open: boolean;
  /** Trackers already in config — used to mark "Already added". */
  existingTrackers: TrackerConfig[];
  /** Called with the TrackerConfig objects the user chose. The caller
   *  persists + creates orbs. */
  onAdd: (additions: TrackerConfig[]) => void;
  onClose: () => void;
}

interface DiscoveredTracker {
  entityId: string;
  friendlyName: string;
  areaEntityId?: string;
  /** 'private_ble_device' | 'bluetooth' | 'gps' | 'router' | 'other' —
   *  inferred from state attributes. Drives the badge + sort order. */
  source: string;
  state: string;
  alreadyAdded: boolean;
}

/** Distinct-ish color palette so new orbs don't all start green. Cycled
 *  through as the user adds trackers. */
const COLOR_PALETTE = ['#4ade80', '#38bdf8', '#a78bfa', '#fb923c', '#f472b6', '#fde047'];

/** Friendly badge text per source. */
function badgeFor(source: string): string | null {
  if (source === 'private_ble_device') return 'Private BLE';
  if (source === 'bluetooth') return 'BLE';
  if (source === 'bluetooth_le') return 'BLE LE';
  if (source === 'gps') return 'GPS';
  if (source === 'router') return 'Router';
  return null;
}

/** Source priority for sort (lower = higher in list). */
function sourceRank(source: string): number {
  if (source === 'private_ble_device') return 0;
  if (source === 'bluetooth' || source === 'bluetooth_le') return 1;
  if (source === 'gps') return 2;
  if (source === 'router') return 4;
  return 3;
}

export default function TrackerDiscoveryModal({
  open,
  existingTrackers,
  onAdd,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackers, setTrackers] = useState<DiscoveredTracker[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const fetchTrackers = useCallback(() => {
    const { mode, haSettings } = getSetting('connection');
    if (mode !== 'live' || !haSettings.url || !haSettings.token) {
      setError('No live HA connection configured. Set one in the Connection settings first.');
      return;
    }
    setLoading(true);
    setError(null);

    const existingIds = new Set(existingTrackers.map((t) => t.entityId.toLowerCase()));
    let connDisposed = false;
    let conn: HAConnection | null = null;

    const finish = () => {
      if (!connDisposed) {
        connDisposed = true;
        conn?.dispose();
      }
      setLoading(false);
    };

    const onInitialStates = (states: HAState[]) => {
      try {
        // Build lookup of all sensor.*_area entities so we can pair a
        // device_tracker with its area sensor (Private BLE Device pattern).
        const areaSensors = new Map<string, string>();
        for (const s of states) {
          if (s.entity_id.startsWith('sensor.') && s.entity_id.endsWith('_area')) {
            // sensor.daniel_s_iphone_area → daniel_s_iphone
            const slug = s.entity_id.slice('sensor.'.length, -'_area'.length);
            areaSensors.set(slug, s.entity_id);
          }
        }

        const out: DiscoveredTracker[] = [];
        for (const s of states) {
          if (!s.entity_id.startsWith('device_tracker.')) continue;
          const slug = s.entity_id.slice('device_tracker.'.length);
          const attrs = (s.attributes || {}) as Record<string, unknown>;
          const friendlyName = (attrs.friendly_name as string) || slug;
          const sourceType = (attrs.source_type as string) || 'other';
          const areaEntityId = areaSensors.get(slug);
          out.push({
            entityId: s.entity_id,
            friendlyName,
            areaEntityId,
            // Bermuda's *_bermuda_tracker entities sit under source_type:gps
            // but they're really BLE-driven — promote them to private_ble_device
            // for sort + badge purposes.
            source: slug.endsWith('_bermuda_tracker') ? 'private_ble_device' : sourceType,
            state: s.state,
            alreadyAdded: existingIds.has(s.entity_id.toLowerCase()),
          });
        }
        out.sort((a, b) => {
          if (a.alreadyAdded !== b.alreadyAdded) return a.alreadyAdded ? 1 : -1;
          const r = sourceRank(a.source) - sourceRank(b.source);
          if (r !== 0) return r;
          return a.friendlyName.localeCompare(b.friendlyName);
        });
        setTrackers(out);
        // Auto-check Private-BLE-Device-style trackers since those are the
        // most likely targets of the "I want to track this" intent.
        const nextChecked: Record<string, boolean> = {};
        for (const t of out) {
          nextChecked[t.entityId] = !t.alreadyAdded && (t.source === 'private_ble_device' || !!t.areaEntityId);
        }
        setChecked(nextChecked);
      } catch (err) {
        console.warn('[TrackerDiscovery] enumerate failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to enumerate trackers.');
      } finally {
        finish();
      }
    };

    conn = new HAConnection(
      { url: haSettings.url, port: haSettings.port, token: haSettings.token },
      { onInitialStates },
    );
    conn.connect();

    const timer = window.setTimeout(() => {
      if (!loading) return;
      setError('Timed out waiting for HA.');
      finish();
    }, 10000);
    return () => {
      window.clearTimeout(timer);
      finish();
    };
  }, [existingTrackers, loading]);

  useEffect(() => {
    if (!open) {
      setTrackers([]);
      setChecked({});
      setError(null);
      return;
    }
    const cleanup = fetchTrackers();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = useCallback(() => {
    const colorStart = existingTrackers.length;
    const additions: TrackerConfig[] = trackers
      .filter((t) => !t.alreadyAdded && checked[t.entityId])
      .map((t, i) => ({
        entityId: t.entityId,
        areaEntityId: t.areaEntityId,
        label: t.friendlyName,
        color: COLOR_PALETTE[(colorStart + i) % COLOR_PALETTE.length],
        diameter: 0.3,
        glow: 1,
        position: { x: 0, y: 1, z: 0 },
        areaPositions: {},
        hideWhenAway: true,
      }));
    if (additions.length > 0) onAdd(additions);
    onClose();
  }, [trackers, checked, existingTrackers.length, onAdd, onClose]);

  const selectedCount = trackers.filter((t) => !t.alreadyAdded && checked[t.entityId]).length;

  if (!open) return null;

  return (
    <div className="discovery-backdrop" onClick={onClose}>
      <div className="discovery-modal" onClick={(e) => e.stopPropagation()}>
        <div className="discovery-header">
          <div className="discovery-title">Discover Trackers</div>
          <button
            className="discovery-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <p className="discovery-prompt">
          Every <code>device_tracker.*</code> HA knows about — Private BLE
          Devices show up at the top. Tick the ones you want as orbs in
          the 3D scene. Position is auto-driven by the BLE solver.
        </p>

        {error && <div className="discovery-error">{error}</div>}

        {loading && (
          <div className="discovery-loading">Asking Home Assistant…</div>
        )}

        {!loading && !error && trackers.length === 0 && (
          <div className="discovery-empty">
            No device_tracker entities found in HA.
          </div>
        )}

        {!loading && trackers.length > 0 && (
          <div className="discovery-list">
            {trackers.map((t) => {
              const badge = badgeFor(t.source);
              return (
                <label
                  key={t.entityId}
                  className={`discovery-row${t.alreadyAdded ? ' added' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="discovery-checkbox"
                    disabled={t.alreadyAdded}
                    checked={t.alreadyAdded || !!checked[t.entityId]}
                    onChange={(e) =>
                      setChecked((prev) => ({ ...prev, [t.entityId]: e.target.checked }))
                    }
                  />
                  <div className="discovery-row-info">
                    <div className="discovery-row-name">
                      {t.friendlyName}
                      {badge && (
                        <span
                          className="discovery-row-badge"
                          style={
                            t.source === 'private_ble_device'
                              ? { background: 'rgba(34, 211, 238, 0.25)', color: '#22d3ee' }
                              : undefined
                          }
                        >
                          {badge}
                        </span>
                      )}
                      {t.alreadyAdded && (
                        <span className="discovery-row-badge">already added</span>
                      )}
                    </div>
                    <div className="discovery-row-meta">
                      {t.entityId} · state={t.state}
                      {t.areaEntityId && ` · ${t.areaEntityId}`}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        <div className="discovery-footer">
          <button
            className="discovery-btn ghost"
            onClick={fetchTrackers}
            disabled={loading}
          >
            Refresh
          </button>
          <div className="discovery-footer-actions">
            <button className="discovery-btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="discovery-btn primary"
              onClick={handleSubmit}
              disabled={selectedCount === 0}
            >
              Add {selectedCount > 0 ? `${selectedCount} ` : ''}
              {selectedCount === 1 ? 'tracker' : 'trackers'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
