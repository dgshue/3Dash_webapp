import { useEffect, useState, useCallback } from 'react';
import type { AnchorConfig } from '../types';
import { HAConnection } from '../services/haWebSocket';
import { dumpBermudaDevices, parseBermudaDump } from '../services/bermudaApi';
import { getSetting } from '../services/settingsStore';
import './BermudaDiscoveryModal.css';

interface Props {
  open: boolean;
  /** Anchors already in config — used to mark "Already added". */
  existingAnchors: AnchorConfig[];
  /** Called with the AnchorConfig objects the user chose. The caller persists
   *  + creates meshes. New anchors arrive as `placed: false` so the user can
   *  click-to-place them next via the existing AnchorForm flow. */
  onAdd: (additions: AnchorConfig[]) => void;
  onClose: () => void;
}

interface DiscoveredScanner {
  address: string;
  name: string;
  floor: string;
  area: string;
  alreadyAdded: boolean;
}

export default function BermudaDiscoveryModal({
  open,
  existingAnchors,
  onAdd,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanners, setScanners] = useState<DiscoveredScanner[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // Cleanest pattern in this codebase: ephemeral HAConnection, like the
  // entity-cache fetch in ConfigEditor. Lives only long enough to call
  // bermuda.dump_devices once, then disposes.
  const fetchScanners = useCallback(() => {
    const { mode, haSettings } = getSetting('connection');
    if (mode !== 'live' || !haSettings.url || !haSettings.token) {
      setError('No live HA connection configured. Set one in the Connection settings first.');
      return;
    }
    setLoading(true);
    setError(null);

    const existingIds = new Set(existingAnchors.map((a) => a.deviceId.toLowerCase()));
    let connDisposed = false;
    let conn: HAConnection | null = null;

    const finish = () => {
      if (!connDisposed) {
        connDisposed = true;
        conn?.dispose();
      }
      setLoading(false);
    };

    const onInitialStates = async () => {
      if (!conn) return;
      try {
        const dump = await dumpBermudaDevices(conn);
        if (!dump) {
          setError('Bermuda dump_devices returned nothing — is the Bermuda integration installed?');
          finish();
          return;
        }
        // Diagnostic — open browser console to see the raw dump shape if
        // the parsed result looks wrong. Cheap, runs once per modal open.
        console.info('[BermudaDiscovery] raw dump shape:', {
          deviceCount: Object.keys(dump.service_response || {}).length,
          sample: Object.entries(dump.service_response || {})[0],
        });
        const parsed = parseBermudaDump(dump);
        console.info(
          `[BermudaDiscovery] parsed ${parsed.anchors.length} scanners from `
          + `${Object.keys(dump.service_response || {}).length} bermuda devices`,
        );
        const next: DiscoveredScanner[] = parsed.anchors.map((a) => ({
          address: a.address,
          name: a.name,
          floor: a.floor || 'Main',
          area: a.area || '',
          alreadyAdded: existingIds.has(a.address.toLowerCase()),
        }));
        // Sort: not-yet-added first, then alphabetical by name.
        next.sort((x, y) => {
          if (x.alreadyAdded !== y.alreadyAdded) return x.alreadyAdded ? 1 : -1;
          return x.name.localeCompare(y.name);
        });
        setScanners(next);
        // Auto-check anything not yet added so the common case is one click.
        const nextChecked: Record<string, boolean> = {};
        for (const s of next) nextChecked[s.address] = !s.alreadyAdded;
        setChecked(nextChecked);
        finish();
      } catch (err) {
        console.warn('[BermudaDiscovery] dump failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch Bermuda devices.');
        finish();
      }
    };

    conn = new HAConnection(
      { url: haSettings.url, port: haSettings.port, token: haSettings.token },
      { onInitialStates },
    );
    conn.connect();

    // Safety net: if onInitialStates never fires we still drop the connection.
    const timer = window.setTimeout(() => {
      if (!loading) return;
      setError('Timed out waiting for HA. Check the connection settings.');
      finish();
    }, 10000);
    return () => {
      window.clearTimeout(timer);
      finish();
    };
  }, [existingAnchors, loading]);

  // Auto-fetch when the modal opens.
  useEffect(() => {
    if (!open) {
      setScanners([]);
      setChecked({});
      setError(null);
      return;
    }
    const cleanup = fetchScanners();
    return cleanup;
    // We deliberately omit fetchScanners from deps — re-running on every
    // render would re-dispatch the WS connect every time `checked` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = useCallback(() => {
    const additions: AnchorConfig[] = scanners
      .filter((s) => !s.alreadyAdded && checked[s.address])
      .map((s, i) => ({
        deviceId: s.address,
        label: s.name || s.address,
        position: {
          x: (i % 3) * 0.4 - 0.4,
          y: s.floor === 'Main' ? 1.5 : 4.0,
          z: Math.floor(i / 3) * 0.4,
        },
        floor: s.floor,
        placed: false,
      }));
    if (additions.length > 0) onAdd(additions);
    onClose();
  }, [scanners, checked, onAdd, onClose]);

  const selectedCount = scanners.filter((s) => !s.alreadyAdded && checked[s.address]).length;

  if (!open) return null;

  return (
    <div className="discovery-backdrop" onClick={onClose}>
      <div className="discovery-modal" onClick={(e) => e.stopPropagation()}>
        <div className="discovery-header">
          <div className="discovery-title">Discover BLE Scanners</div>
          <button
            className="discovery-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <p className="discovery-prompt">
          Every BLE scanner Bermuda sees can be added — including proxies
          (Voice, Kiosk, Tower BLE Adapter) and dedicated anchors. After
          adding, click &ldquo;Pick From Scene&rdquo; on each one to
          position it in 3D.
        </p>

        {error && <div className="discovery-error">{error}</div>}

        {loading && (
          <div className="discovery-loading">Asking Home Assistant…</div>
        )}

        {!loading && !error && scanners.length === 0 && (
          <div className="discovery-empty">
            Bermuda reported zero scanners. Make sure the integration is set
            up in HA and at least one BLE proxy is online.
          </div>
        )}

        {!loading && scanners.length > 0 && (
          <div className="discovery-list">
            {scanners.map((s) => (
              <label
                key={s.address}
                className={`discovery-row${s.alreadyAdded ? ' added' : ''}`}
              >
                <input
                  type="checkbox"
                  className="discovery-checkbox"
                  disabled={s.alreadyAdded}
                  checked={s.alreadyAdded || !!checked[s.address]}
                  onChange={(e) =>
                    setChecked((prev) => ({ ...prev, [s.address]: e.target.checked }))
                  }
                />
                <div className="discovery-row-info">
                  <div className="discovery-row-name">
                    {s.name}
                    {s.alreadyAdded && (
                      <span className="discovery-row-badge">already added</span>
                    )}
                  </div>
                  <div className="discovery-row-meta">
                    {s.address} {s.floor && `· ${s.floor}`}
                    {s.area && ` · ${s.area}`}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="discovery-footer">
          <button
            className="discovery-btn ghost"
            onClick={fetchScanners}
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
              {selectedCount === 1 ? 'scanner' : 'scanners'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
