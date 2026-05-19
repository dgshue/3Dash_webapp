import type { CalibrationFingerprint, LightPosition } from '../types';

/**
 * Phase 4: k-NN fingerprint positioning.
 *
 * Given a live RSSI reading per anchor and a set of training fingerprints
 * captured by the calibration wizard, pick the K nearest neighbors in RSSI
 * space and return the weighted average of their positions.
 *
 * "RSSI space distance" between live reading and a fingerprint is the
 * root-mean-square dBm difference across anchors that BOTH samples saw.
 * Fingerprints with fewer than `minSharedAnchors` overlapping anchors are
 * skipped (no signal to compare). The result's confidence is a crude
 * 1 − topDistance / dBmHorizon mapping; useful for the Dashboard to decide
 * whether to defer to trilateration when k-NN is unsure.
 *
 * Why per-anchor RMS rather than total Euclidean: the user has 7 anchors,
 * but any given fingerprint may have heard only 3-5 of them. Averaging
 * across the shared set prevents fingerprints with more overlap from
 * automatically appearing "closer" purely because they have more terms.
 *
 * Returns null when:
 *   - the live reading has 0 anchors, or
 *   - no fingerprint shares ≥ minSharedAnchors with the live reading.
 */

export interface KnnInput {
  /** Per-anchor RSSI in dBm for the current live reading. Keyed by anchor
   *  deviceId (lowercase). Anchors not seen by the phone are simply
   *  omitted. */
  rssiByAnchor: Record<string, number>;
  /** Training fingerprints — typically filtered to those captured for the
   *  same tracker (phone) so different family members don't cross-pollute. */
  fingerprints: CalibrationFingerprint[];
  /** Number of neighbors to average (default 3). Actual count may be lower
   *  if fewer fingerprints qualify. */
  k?: number;
  /** Minimum anchors that must overlap between live reading and a
   *  fingerprint for the fingerprint to be considered. Default 2 — below
   *  that we'd just be matching on noise. */
  minSharedAnchors?: number;
}

export interface KnnResult {
  /** World-space position (Babylon coords). */
  position: LightPosition;
  /** Confidence in [0, 1] — higher means the live RSSI was closer to the
   *  matched fingerprints. 0.6+ is "trust this", 0.3 is "barely better than
   *  random". */
  confidence: number;
  /** RMS dBm distance to the nearest fingerprint. Useful for diagnostics. */
  topDistance: number;
  /** How many fingerprints qualified (had enough shared anchors). Useful
   *  for the "if ≥ 3 qualified" gate in the design doc. */
  qualifiedCount: number;
}

/** Map topDistance (dBm RMS) to a 0..1 confidence. The horizon controls how
 *  far away "fully uncertain" sits — 15 dBm RMS is a fairly aggressive
 *  cliff that matches PadSpan's empirical observations. */
const DEFAULT_DBM_HORIZON = 15;

export function knnMatch(input: KnnInput): KnnResult | null {
  const liveKeys = Object.keys(input.rssiByAnchor);
  if (liveKeys.length === 0) return null;

  const k = input.k ?? 3;
  const minShared = input.minSharedAnchors ?? 2;

  type Scored = { fp: CalibrationFingerprint; dist: number; shared: number };
  const scored: Scored[] = [];

  for (const fp of input.fingerprints) {
    const shared: string[] = [];
    for (const key of liveKeys) {
      if (key in fp.rssiByAnchor) shared.push(key);
    }
    if (shared.length < minShared) continue;
    let sqSum = 0;
    for (const key of shared) {
      const diff = input.rssiByAnchor[key] - fp.rssiByAnchor[key];
      sqSum += diff * diff;
    }
    const rms = Math.sqrt(sqSum / shared.length);
    scored.push({ fp, dist: rms, shared: shared.length });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => a.dist - b.dist);
  const top = scored.slice(0, k);

  // Inverse-distance weighting with a floor so a perfect match doesn't blow
  // up (1/0).
  let totalW = 0, x = 0, y = 0, z = 0;
  for (const s of top) {
    const w = 1 / Math.max(s.dist, 0.1);
    totalW += w;
    x += s.fp.position.x * w;
    y += s.fp.position.y * w;
    z += s.fp.position.z * w;
  }
  if (totalW === 0) return null;
  const position: LightPosition = {
    x: x / totalW,
    y: y / totalW,
    z: z / totalW,
  };

  const topDistance = top[0].dist;
  const confidence = 1 - Math.min(topDistance / DEFAULT_DBM_HORIZON, 1);
  return {
    position,
    confidence,
    topDistance,
    qualifiedCount: scored.length,
  };
}
