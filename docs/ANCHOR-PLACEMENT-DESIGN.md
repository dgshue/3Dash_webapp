# Anchor Placement, Calibration & Positioning — Comprehensive Design

This document is the source of truth for the next major iteration of 3Dash's
real-time location feature. It's a continuation of the BLE-POSITIONING-PLAN.md
Phase A–C work and builds toward a simplified, better version of PadSpan.
Read alongside `BLE-POSITIONING-PLAN.md` and `PHASE-LOG.md`.

## Problem statement

Phase B/C shipped weighted-centroid + trilateration positioning that's already
working architecturally. But the user reports two surface-level gaps:

1. **Only 3 anchors are visible in the Anchors tab — should be all 7.**
   The user has 6 BLE proxies (Voice 0905ac, RuView Kiosk, Button Box, plus
   the 3 new S3 anchors upstairs) and 1 USB BLE adapter (TP-Link UB500 on the
   Ubuntu host). Bermuda sees all 7 scanners. 3Dash only auto-discovers the 3
   upstairs S3s because Phase B's filter is `name.contains('anchor')`.

2. **The placement workflow is buried.** Anchors tab only exists in the
   `/#/editor` route. The dashboard view has no obvious affordance to position
   anchors or visualize where they are. Calibration is hidden in Bermuda's HA
   settings page, not in 3Dash itself.

The deeper opportunity: build the simplified PadSpan replacement we deserve —
real-time fingerprint-aware positioning with a 3-tap calibration UX instead of
PadSpan's 4-points-per-room form-filling.

## Root cause of the "only 3 anchors" bug

In `src/pages/Dashboard/Dashboard.tsx` (search for "anchor" auto-discovery),
the Phase B agent filtered Bermuda devices by **name substring**:

```ts
const isAnchor = (name: string) => /anchor|bermuda/i.test(name);
```

This was a heuristic because the agent expected user-named devices to follow
that naming pattern. Reality:

| Bermuda scanner | name | matched by filter? |
|---|---|---|
| Home Assistant Voice 0905ac | "Home Assistant Voice 0905ac" | ✗ |
| RuView Kiosk | "RuView Kiosk" | ✗ |
| Button Box | "Button Box" | ✗ |
| Master Bedroom Anchor | "Master Bedroom Anchor" | ✓ (contains "Anchor") |
| Greyson's Room Anchor | "Greyson's Room Anchor" | ✓ |
| Keek's Bedroom Anchor | "Keek's Bedroom Anchor" | ✓ |
| Tower BLE Adapter | "Tower BLE Adapter" | ✗ |

**The correct filter** is the `_is_scanner: true` flag in
`bermuda.dump_devices` output. Every Bermuda scanner has this field. No name
heuristic needed.

```ts
const scannerDevices = Object.entries(dumpResponse.service_response)
  .filter(([_, dev]) => dev._is_scanner === true)
  .map(([addr, dev]) => ({ deviceAddress: addr, ...dev }));
```

This is the **Phase 0** of the new work — a one-line fix in `bermudaApi.ts`
or wherever the discovery filter lives.

## Vision: simplified PadSpan replacement

PadSpan's research (we ran v0.20.62 briefly before removing) used:

- **k-NN fingerprint positioning**: train at known points by recording
  (location, {rssi_per_scanner}); for live position, find K nearest neighbors
  in RSSI space and vote.
- **Per-beacon signal profiles**: AvgRSSI, Variance, Reach, Multi% per device
  to characterize signal quality.
- **Manual calibration points**: user taps to record fingerprints at known
  spots. PadSpan accumulated 4 cal points per room.
- **Multiple solvers in parallel**: k-NN, trilateration, weighted-centroid
  — selected by data availability.

What PadSpan got right:
- Real-time response. Phone moved → on-screen marker moved within seconds.
- k-NN handles non-line-of-sight signal multipath better than trilateration.
- BLE beacon profile concept lets you trust some scanners more than others.
- "Auto Diagnostics" button surfaced config problems plainly.

What PadSpan got wrong (user explicitly cited):
- UI was too dense. Every parameter editable, no defaults that "just work".
- Calibration was tedious — 4 spots × per-room × per-anchor = many prompts.
- 2D floor plan only. The "3D effect" was slider tricks, not true 3D.
- BLE Transmitter sensor pairing was a separate flow from Private BLE Device.
- Floor detection was implicit; cross-floor confusion happened.

**Our goal**: keep the math (k-NN + trilateration + degradation), drop the
ceremony. Calibration becomes a 3-tap "stand here, tap, walk to next spot"
flow. Default values work for 80% of homes. UI lives in 3Dash where the user
already is, not in a separate HA panel.

## Data model

Extend `AnchorConfig`:

```ts
export interface AnchorConfig {
  deviceId: string;           // Bermuda scanner deviceAddress (MAC or token)
  label: string;
  position: LightPosition;    // (x, y, z) in 3D world coords
  floor: 'Main' | 'Upper' | 'Auto';
  hidden?: boolean;           // user can exclude an anchor without deleting

  // Calibration (all optional — defaults below)
  refPower?: number;          // default -55 dBm at 1m
  pathLossExp?: number;       // default 3.0
  antennaGainDbi?: number;    // default 0
  trustWeight?: number;       // 0.0-1.0, default 1.0; let user downweight unreliable anchors
}
```

New type `CalibrationFingerprint`:

```ts
export interface CalibrationFingerprint {
  id: string;                       // uuid
  position: LightPosition;          // where user stood
  floor: 'Main' | 'Upper';
  rssiByAnchor: Record<string, number>;   // deviceId -> rssi (dBm)
  distanceByAnchor: Record<string, number>; // deviceId -> meters (from Bermuda)
  timestamp: number;
  label?: string;                   // e.g. "Living Room couch"
}
```

Stored in `localStorage["3dash.calibration"]`. Eventually exportable as JSON
for backup.

## UI components (new)

### 1. AnchorPanel — live dashboard sidebar (not buried in /editor)

Floating panel toggle (top-right corner of dashboard, near the existing
settings cog). Shows:

```
ANCHORS (7)
  Main floor (3)
    ● Voice 0905ac        Kitchen        -42 dBm
    ● RuView Kiosk        Kitchen        -38 dBm
    ● Button Box          Living Room    -57 dBm
  Upper floor (3)
    ● Master Bedroom      not placed     —
    ● Greyson's Room      not placed     —
    ● Keek's Bedroom      not placed     —
  Other (1)
    ● Tower BLE Adapter   not placed     —

[+ Place Anchor]  [Calibrate]  [Diagnostics]
```

Click an anchor row → enters placement mode for that anchor. Auto-cycle to
next unplaced anchor on save. "not placed" = position is (0,0,0) default.

### 2. Click-to-place mode (extends existing PickMode.ts)

When active:
- Crosshair cursor on canvas
- Hovering surfaces shows a ghost cyan pin at the snap location
- Floor mesh under cursor is highlighted
- Click → captures (x,y,z), snaps y to nearest floor (Main=1.2 or Upper=4.0
  unless user holds Shift to use raw pick y)
- Live preview: distance lines from this prospective anchor to all currently-
  tracked phones, with the measured Bermuda distance shown on each line
- Confirm/Cancel buttons

### 3. Calibration wizard

Single-page modal triggered by "Calibrate" button:

```
Step 1 of 3 — Pick a reference spot
  Stand somewhere distinctive (e.g. couch, kitchen island).
  When ready, tap the floor in the 3D scene where you are.

Step 2 of 3 — Confirm
  We'll record what each anchor sees from there.
  [I'm standing at (1.2, 0, -2.4) on Main floor]
  [Confirm] [Re-pick]

Step 3 of 3 — Done
  Recorded RSSI from 7 anchors. 
  Total fingerprints: 3 (need ≥5 for k-NN)
  [Add another fingerprint] [Finish]
```

No per-room separate flow. Just keep adding fingerprints. The system uses
them as training data automatically.

### 4. Diagnostics overlay

Visual debug mode toggled from AnchorPanel:
- Render each anchor's measured distance to the currently-followed tracker
  as a translucent sphere
- Color-code: green if measured distance is consistent across phones, red if
  inconsistent (suggests poor placement or bad calibration)
- Show per-anchor "trust score" derived from variance over the last 60s
- Highlight any anchor whose measured RSSI hasn't changed in 5 min (dead/stale)

## Solver chain (extended from Phase C)

```
For each tracker, every 3 Hz:

1. Gather per-anchor distance from Bermuda dump_devices.

2. k-NN fingerprint match:
   - If >= 5 fingerprints AND >= 3 of them are within "RSSI proximity" of
     current reading, take weighted k-NN position (k=3 typical).
   - Return position + confidence (1 - mean fingerprint distance / room scale).

3. Trilateration (Phase C):
   - If k-NN unavailable OR confidence low, fall back to Gauss-Newton.
   - Use Phase C's existing Trilateration.ts.
   - Floor-band constraint via sensor.<phone>_floor.

4. Weighted centroid (Phase B):
   - Fallback if <3 same-floor anchors with distance.

5. Area snap (Phase A):
   - Final fallback when Bermuda has no per-anchor data.

6. Always feed through Kalman (PositionKalman.ts).
```

k-NN math (simplified):

```ts
function knnMatch(currentRssi: Record<string, number>, fingerprints: CalibrationFingerprint[], k = 3) {
  const distances = fingerprints.map(fp => {
    const sharedAnchors = Object.keys(currentRssi).filter(a => a in fp.rssiByAnchor);
    if (sharedAnchors.length < 2) return { fp, dist: Infinity };
    const sqSum = sharedAnchors.reduce((s, a) => s + Math.pow(currentRssi[a] - fp.rssiByAnchor[a], 2), 0);
    return { fp, dist: Math.sqrt(sqSum / sharedAnchors.length) };
  });
  distances.sort((a, b) => a.dist - b.dist);
  const top = distances.slice(0, k).filter(d => d.dist < Infinity);
  if (top.length === 0) return null;
  const totalWeight = top.reduce((s, d) => s + 1/Math.max(d.dist, 0.1), 0);
  const pos = top.reduce((acc, d) => {
    const w = 1/Math.max(d.dist, 0.1) / totalWeight;
    return { x: acc.x + d.fp.position.x*w, y: acc.y + d.fp.position.y*w, z: acc.z + d.fp.position.z*w };
  }, { x: 0, y: 0, z: 0 });
  const confidence = 1 - Math.min(top[0].dist / 20, 1);  // crude
  return { pos, confidence };
}
```

## Implementation phases (next session)

### Phase 0 — Anchor discovery fix ✅ SHIPPED (2026-05-18)
- Already shipped via commit `3b8473a` ("fix(phase-c): merge ALL Bermuda
  scanners as anchors, not just unconfigured"). Beat this design doc by ~24h.
- `parseBermudaDump` in `src/services/bermudaApi.ts` filters by
  `dev._is_scanner === true` (line 164).
- `Dashboard.tsx` auto-discovery (lines 1386-1422) merges any missing
  scanner into `config.anchors`, stacking new ones near origin so the user
  can click-to-place each.
- Floor auto-populated from `dev.floor_name` (Bermuda mirrors HA's area→floor).
- Carryover for Phase 1: stored configs from the Phase B era (3-anchor regex
  filter) get the other 4 backfilled on next Bermuda poll. So the UX gap
  reported by the user ("only 3 anchors visible") is the AnchorList UI
  rendering against stale storage — Phase 1 surfaces it correctly.

### Phase 1 — AnchorPanel dashboard widget (1 day)
- New floating panel in dashboard view (not just /editor)
- Floor grouping, live RSSI display, "place" action per anchor
- Click-to-place mode that auto-cycles through unplaced anchors
- Save positions to localStorage on confirm
- Show "X of Y placed" progress bar

### Phase 2 — Schema + per-anchor calibration values (half day)
- Extend `AnchorConfig` with refPower, pathLossExp, antennaGainDbi, trustWeight
- AnchorForm exposes them (collapsed by default, expand for "Advanced")
- Sane defaults — if not set, use global Bermuda defaults

### Phase 3 — Calibration wizard (1 day)
- 3-tap fingerprint capture flow
- Store fingerprints in localStorage
- Show fingerprint count + spatial coverage (map of fingerprint positions on
  the floor plan)
- "Suggest where to add fingerprints" — picks underserved regions

### Phase 4 — k-NN solver integration (half day)
- New `FingerprintSolver.ts` with knnMatch math above
- Insert at top of solver chain in Dashboard.tsx
- Confidence threshold for whether k-NN result is preferred over trilateration

### Phase 5 — Diagnostics overlay (half day)
- Toggle in AnchorPanel: render distance spheres
- Per-anchor trust score (rolling 60s variance)
- "Anchor health" badges in AnchorPanel list

### Phase 6 — HA add-on packaging (half day)
- Already partly done: `3dash-addon/` exists, `repository.json` now points at fork
- Flip `ingress: true` in `3dash-addon/config.yaml`, remove `ports:`
- Build hook to run `npm run build -- --mode addon` and serve from `dist/`
- Test install via Supervisor → Add Repository → install our fork
- Update HA Floor Plan iframe to point at the add-on ingress URL
- Companion App works natively (HA's cert, HA's ingress proxy)

### Phase 7 — Polish (1 day)
- Diagnostics: per-anchor "I haven't heard you in N seconds" warning
- Export fingerprints + anchor config as a downloadable JSON
- Re-import flow (so reflashing the dev container doesn't wipe calibration)
- Confidence ellipsoid rendering around the orb (Phase C left this as TODO)

Total estimate: ~5 days of focused work for a properly-integrated
PadSpan-replacement positioning layer inside 3Dash.

## What to do in the next session

Read this doc first. Read `BLE-POSITIONING-PLAN.md` for context on the Phase
A–C work that's already shipped. Read `PHASE-LOG.md` for the actual commit
log. Then:

1. Start with **Phase 0** — fix the anchor discovery filter. That single
   change makes the existing Anchors tab show all 7 scanners.
2. Iterate through Phase 1–7 in order. Each phase is independently shippable.
3. After Phase 6 (add-on packaging), test in Companion App. That's the
   ultimate UX goal.

## Carryover bugs to address along the way

- **Anchors tab access** is currently buried in `/#/editor`. Phase 1 fixes
  this by lifting the AnchorPanel into the main dashboard view.
- **Self-signed cert blocking Companion App**. Phase 6 fixes by serving via
  HA ingress.
- **No way to backup calibration data**. Phase 7 fixes by export/import.
- **Confidence isn't visualized**. Phase 7 fixes by rendering ellipsoid.

## Reference: PadSpan repo (for inspiration only — do not import)

We removed PadSpan as an installed integration. Their code is at:
https://github.com/jingstad/padspan (if needed for research)

Specifically worth reading from PadSpan source:
- Their k-NN implementation (Python, server-side)
- Their auto-pair flow for HA Companion BLE Transmitter
- Their beacon profile averaging code

We're NOT importing PadSpan code. We're building cleaner versions of the same
math + UX in TypeScript/Babylon inside 3Dash.

## Related design docs

- `BLE-POSITIONING-PLAN.md` — Phase A/B/C foundations (room snap, weighted
  centroid, trilateration + Kalman)
- `PHASE-LOG.md` — shipped phases log
- `repository.json` — HA add-on store entry (points at dgshue fork)
- `3dash-addon/config.yaml` — HA add-on config (needs `ingress: true` patch)
