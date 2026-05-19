import type { CalibrationFingerprint } from '../types';

/**
 * Phase 3: localStorage-backed store for calibration fingerprints.
 *
 * Schema:
 *   localStorage["3dash.calibration"] = JSON.stringify({
 *     version: 1,
 *     fingerprints: CalibrationFingerprint[],
 *   })
 *
 * Future Phase 7 will add export/import flows that round-trip this same JSON
 * shape. Keeping the version field upfront so a schema migration doesn't have
 * to guess what era a payload came from.
 */

const STORAGE_KEY = '3dash.calibration';
const CURRENT_VERSION = 1;

interface StoredCalibration {
  version: number;
  fingerprints: CalibrationFingerprint[];
}

function emptyStore(): StoredCalibration {
  return { version: CURRENT_VERSION, fingerprints: [] };
}

function readRaw(): StoredCalibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<StoredCalibration>;
    if (!parsed || !Array.isArray(parsed.fingerprints)) return emptyStore();
    return {
      version: typeof parsed.version === 'number' ? parsed.version : CURRENT_VERSION,
      fingerprints: parsed.fingerprints as CalibrationFingerprint[],
    };
  } catch (err) {
    console.warn('[3Dash][calibration] failed to read store:', err);
    return emptyStore();
  }
}

function writeRaw(store: StoredCalibration): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn('[3Dash][calibration] failed to write store:', err);
  }
}

/** Read all fingerprints (sorted by most-recent first). */
export function getFingerprints(): CalibrationFingerprint[] {
  const store = readRaw();
  return store.fingerprints
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);
}

/** Append a fingerprint and persist. Returns the new total count. */
export function addFingerprint(fp: CalibrationFingerprint): number {
  const store = readRaw();
  store.fingerprints.push(fp);
  writeRaw(store);
  return store.fingerprints.length;
}

/** Delete a fingerprint by id. Returns true if anything was removed. */
export function deleteFingerprint(id: string): boolean {
  const store = readRaw();
  const idx = store.fingerprints.findIndex((f) => f.id === id);
  if (idx < 0) return false;
  store.fingerprints.splice(idx, 1);
  writeRaw(store);
  return true;
}

/** Wipe all fingerprints. Used by "reset" actions / tests. */
export function clearFingerprints(): void {
  writeRaw(emptyStore());
}

/** Export the entire store as a downloadable JSON blob (Phase 7 hook). */
export function exportFingerprintsJSON(): string {
  return JSON.stringify(readRaw(), null, 2);
}

/** Import a JSON blob produced by exportFingerprintsJSON. Returns the new
 *  total count. Throws if the payload doesn't look right. */
export function importFingerprintsJSON(raw: string, mode: 'replace' | 'merge' = 'merge'): number {
  const parsed = JSON.parse(raw) as Partial<StoredCalibration>;
  if (!parsed || !Array.isArray(parsed.fingerprints)) {
    throw new Error('Invalid calibration payload: missing fingerprints[].');
  }
  const incoming = parsed.fingerprints as CalibrationFingerprint[];
  if (mode === 'replace') {
    writeRaw({ version: CURRENT_VERSION, fingerprints: incoming });
    return incoming.length;
  }
  const existing = readRaw();
  const byId = new Map(existing.fingerprints.map((f) => [f.id, f]));
  for (const fp of incoming) byId.set(fp.id, fp);
  const merged = Array.from(byId.values());
  writeRaw({ version: CURRENT_VERSION, fingerprints: merged });
  return merged.length;
}

/** Generate a UUID v4. Falls back to a non-crypto random for browsers without
 *  crypto.randomUUID (older WebViews / HA Companion App on some phones). */
export function generateFingerprintId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const r = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${r()}${r()}-${r()}-${r()}-${r()}-${r()}${r()}${r()}`;
}
