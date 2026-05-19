import type { HALike } from './haWebSocket';

/**
 * Bermuda integration — per-anchor distance discovery.
 *
 * Data shape (verified 2026-05-18 against ha.shuehome.net):
 *
 *   service:  bermuda.dump_devices  (must include `return_response: true`)
 *   result:   { service_response: { [deviceAddress: string]: BermudaDevice } }
 *
 * Every Bermuda-known device shows up keyed by its address:
 *   - Phones / IRK trackers use a 32-hex IRK as the address.
 *   - Anchors / ESPHome scanners use a real MAC (e0:72:a1:...) — those have
 *     `_is_scanner === true`.
 *   - Random BLE advertisers (Apple AirPods etc.) show up too — ignore those.
 *
 * For trackers (phones), the per-scanner distance lives in
 *   device.adverts[<sourceMac>__<scannerMac>].rssi_distance       (Kalman-filtered)
 *   device.adverts[<sourceMac>__<scannerMac>].rssi_distance_raw   (raw, fallback)
 *
 * A single tracker may report several `<sourceMac>__<scannerMac>` rows because
 * its IRK rotates through multiple `metadevice_sources` MACs. We aggregate
 * per-scanner by taking the MINIMUM distance across sources (closest reading
 * wins — that's the most recent / least-attenuated advert).
 *
 * Also exposed on each tracker:
 *   - floor_name  ("Main" / "Upper")  — pre-computed by Bermuda, mirrors
 *                                       sensor.<phone>_floor
 *   - area_name   ("Dining Room")     — pre-computed by Bermuda, mirrors
 *                                       sensor.<phone>_area
 *
 * Scanners themselves have name_devreg / area_name / floor_name fields that
 * we use for anchor auto-discovery.
 */

export interface BermudaAdvert {
  scanner_address: string;
  device_address: string;
  name: string;                 // human name of the scanner (anchor)
  rssi: number | null;
  rssi_distance: number | null | 'None';
  rssi_distance_raw: number | null;
}

export interface BermudaDevice {
  name?: string | null;
  name_devreg?: string | null;
  name_by_user?: string | null;
  address: string;
  area_name?: string | null;
  area_last_seen?: string | null;
  floor_name?: string | null;
  /** True for ESPHome anchors / BLE scanners. */
  _is_scanner?: boolean;
  metadevice_type?: string[] | null;
  /** Map of "<sourceMac>__<scannerMac>" → advert details (per-scanner readings). */
  adverts?: Record<string, BermudaAdvert>;
}

export interface BermudaDumpResponse {
  service_response: Record<string, BermudaDevice>;
}

export interface AnchorReading {
  /** Anchor MAC address (lowercase, colons). Used as the AnchorConfig.deviceId. */
  scannerAddress: string;
  /** Human name from Bermuda (e.g. "Master Bedroom Anchor"). */
  scannerName: string;
  /** Distance in meters (number ≥ 0). NaN if unavailable. */
  distance: number;
  /** Raw RSSI in dBm (e.g. -64). NaN if Bermuda didn't include one for this
   *  advert. Used by Phase 3 calibration capture and Phase 4 k-NN matching. */
  rssi: number;
}

export interface ParsedBermudaTracker {
  /** Top-level Bermuda device address (IRK for phones). */
  address: string;
  /** "Daniel's iPhone" */
  name: string;
  /** "Main" / "Upper" — what Bermuda thinks. */
  floor: string;
  /** "Dining Room" — what Bermuda thinks. */
  area: string;
  /** Per-anchor distance readings (one entry per scanner that saw the tracker). */
  readings: AnchorReading[];
}

export interface ParsedBermudaAnchor {
  /** Anchor MAC (lowercase). */
  address: string;
  /** Human name from Bermuda. */
  name: string;
  /** "Main" / "Upper" — area floor. */
  floor: string;
  /** Area name from the HA area registry. */
  area: string;
}

/** Send `bermuda.dump_devices` via the HA WebSocket and return the parsed JSON.
 *
 *  Returns null if not connected or the call fails. Throws are logged as warnings.
 */
export async function dumpBermudaDevices(ha: HALike | null): Promise<BermudaDumpResponse | null> {
  if (!ha || !ha.isConnected) return null;
  try {
    // Per HA WS API: call_service with return_response: true puts the service
    // response in result.response when success === true.
    const result = await ha.request({
      type: 'call_service',
      domain: 'bermuda',
      service: 'dump_devices',
      return_response: true,
    }) as { response?: BermudaDumpResponse } | BermudaDumpResponse | null;
    if (!result) return null;
    // The HA WS payload comes back as { response: {...} } when return_response
    // is set; older HA versions may inline service_response directly.
    if ('response' in (result as object) && (result as { response: unknown }).response) {
      return (result as { response: BermudaDumpResponse }).response;
    }
    if ('service_response' in (result as object)) {
      return result as BermudaDumpResponse;
    }
    return null;
  } catch (err) {
    console.warn('[Bermuda] dump_devices failed:', err);
    return null;
  }
}

/** Pick the best distance value out of an advert (filtered → raw fallback). */
function readingDistance(a: BermudaAdvert): number {
  const v = a.rssi_distance;
  if (typeof v === 'number' && isFinite(v)) return v;
  const raw = a.rssi_distance_raw;
  if (typeof raw === 'number' && isFinite(raw)) return raw;
  return Number.NaN;
}

/** Strip an IRK / hex string to lowercase. MACs are kept colon-separated. */
function normalizeAddr(addr: string): string {
  return (addr || '').toLowerCase();
}

/** Parse a dump_devices response into trackers + anchors.
 *
 *  - Trackers: any device whose metadevice_type includes 'private_ble_device'
 *    OR whose address is a 32-hex IRK. Phones/watches with IRKs are the
 *    primary target — random BLE advertisers are filtered out.
 *  - Anchors: any device with `_is_scanner === true`. Distinct from
 *    "scanner-like" beacons; this flag is Bermuda-authoritative.
 *  - For each tracker, walk `adverts` and aggregate per-scanner distance by
 *    taking the minimum across all sourceMac entries that hit that scanner.
 */
export function parseBermudaDump(dump: BermudaDumpResponse): {
  trackers: ParsedBermudaTracker[];
  anchors: ParsedBermudaAnchor[];
} {
  const trackers: ParsedBermudaTracker[] = [];
  const anchors: ParsedBermudaAnchor[] = [];
  const entries = Object.entries(dump.service_response || {});

  for (const [addr, dev] of entries) {
    if (!dev) continue;
    const name = (dev.name_by_user || dev.name_devreg || dev.name || addr) as string;

    if (dev._is_scanner === true) {
      anchors.push({
        address: normalizeAddr(addr),
        name,
        floor: dev.floor_name || 'Main',
        area: dev.area_name || '',
      });
      continue;
    }

    // Tracker filter: include if it's a private BLE device (IRK-tracked phone)
    // OR if it has at least one advert (Bermuda has seen it). Skip anchors.
    const hasAdverts = dev.adverts && Object.keys(dev.adverts).length > 0;
    const isPrivateBle = Array.isArray(dev.metadevice_type) && dev.metadevice_type.includes('private_ble_device');
    if (!isPrivateBle && !hasAdverts) continue;
    // Only include private BLE devices as trackers — everything else is just
    // ambient BLE noise (AirPods, beacons, neighbor's Tile, etc.).
    if (!isPrivateBle) continue;

    const perScanner: Record<string, number> = {};
    const scannerNames: Record<string, string> = {};
    const scannerRssi: Record<string, number> = {};
    for (const advert of Object.values(dev.adverts || {})) {
      const scAddr = normalizeAddr(advert.scanner_address || '');
      if (!scAddr) continue;
      const d = readingDistance(advert);
      if (!isFinite(d)) continue;
      if (perScanner[scAddr] === undefined || d < perScanner[scAddr]) {
        perScanner[scAddr] = d;
        scannerNames[scAddr] = advert.name || scAddr;
        // Take the rssi from the advert that produced the winning (min) distance.
        scannerRssi[scAddr] = typeof advert.rssi === 'number' && isFinite(advert.rssi)
          ? advert.rssi
          : Number.NaN;
      }
    }

    const readings: AnchorReading[] = Object.entries(perScanner).map(([scAddr, d]) => ({
      scannerAddress: scAddr,
      scannerName: scannerNames[scAddr] || scAddr,
      distance: d,
      rssi: scannerRssi[scAddr] ?? Number.NaN,
    }));

    trackers.push({
      address: normalizeAddr(addr),
      name,
      floor: dev.floor_name || '',
      area: dev.area_name || dev.area_last_seen || '',
      readings,
    });
  }

  return { trackers, anchors };
}

/** Match a Bermuda tracker (by address / name) to a configured TrackerConfig's
 *  entity ID. Bermuda's private_ble_device address IS the IRK; HA's
 *  device_tracker.<slug> entity is derived from the friendly name. We try
 *  several strategies because the link isn't 1:1:
 *
 *    1. Direct: if cfg.entityId === 'device_tracker.<addr>' literally.
 *    2. Slug: build a slug from the Bermuda name and compare entity tail.
 *    3. Friendly-name: compare lowercased cfg.label vs Bermuda name.
 */
export function findTrackerEntityForBermuda(
  bermuda: ParsedBermudaTracker,
  trackerEntityIds: Array<{ entityId: string; label?: string }>,
): string | null {
  const addrLower = bermuda.address.toLowerCase();
  const nameLower = (bermuda.name || '').toLowerCase();
  const slug = nameLower.replace(/['‘’ʼ`]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  for (const t of trackerEntityIds) {
    const tail = t.entityId.replace(/^device_tracker\./, '');
    if (tail.toLowerCase() === addrLower) return t.entityId;
    if (tail.toLowerCase() === slug) return t.entityId;
    if ((t.label || '').toLowerCase() === nameLower) return t.entityId;
  }
  return null;
}
