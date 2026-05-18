# 3Dash BLE Positioning — Implementation Plan

This document is the source of truth for an autonomous multi-phase build that
turns 3Dash into a real-time BLE positioning visualization for Home Assistant
households. Each phase is buildable in isolation by a subagent given this file
+ the existing codebase. **Read the codebase before assuming anything — these
specs are point-in-time and may drift.**

## Context

- Fork: dgshue/3Dash_webapp (upstream Kdcius/3Dash_webapp)
- Branch: `dev` (deploys via Portainer stack 157 every 5 min on push)
- Dev URL: https://192.168.1.10:8443/ (self-signed HTTPS)
- Local source: `E:\GitHub\3Dash_webapp` on dgshue's workstation
- Build: `npm run build -- --mode addon` (relative asset paths for HA add-on)
- Test loop: edit → push → wait 5 min for Portainer rebuild → reload browser
  Force-redeploy via Portainer API if needed:
  `curl -X PUT https://192.168.1.10:9443/api/stacks/157/git/redeploy?endpointId=3`

## Existing BLE tracker feature (already shipped)

Phase 0 was completed in commits `d9e5a5a`/`084ca43`. State today:

- `src/types/index.ts` defines `TrackerConfig` with `position`, `areaPositions:
  Record<string, LightPosition>`, `entityId`, `areaEntityId`.
- `src/babylon/TrackerMeshFactory.ts` exports
  `createTrackerMesh / animateTrackerTo / setTrackerPosition / setTrackerVisible
  / disposeAllTrackers / removeTrackerMesh / targetForArea`. Animation is
  500 ms CubicEase Vector3 lerp.
- `src/pages/Dashboard/Dashboard.tsx`:
  - `autoDiscoverTrackersFromStates(states)` near line 1055 — runs once when
    `config.trackers` is empty. Filters `device_tracker.*` with
    `attributes.source_type === 'bluetooth_le'`, creates one TrackerConfig per
    device, places spheres in a circle around origin, hardcodes 5 default
    `areaPositions` keyed by `area_id` slug.
  - `onStateChanged` handler routes `sensor.*_area` updates through
    `targetForArea` + `animateTrackerTo`.
  - `onInitialStates` does the same on first connect.

## Known bug (the reason the green orb doesn't move)

HA's `sensor.<phone>_area` returns the **human-readable area name** like
`"Dining Room"` — *not* the slug. `cfg.areaPositions` uses slugs like
`dining_room`. The lookup `cfg.areaPositions[areaId]` therefore always misses
and `targetForArea` returns the default position. **All three phones report
correct areas in HA right now** (Daniel→Dining Room, Keek→Greyson's Room) so
this is purely a 3Dash bug.

Fix sketch — normalize both sides:

```ts
function normalize(s: string | undefined): string {
  return (s || '').toLowerCase().replace(/['`'']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
```

Apply to `targetForArea` AND to the default-area keys when seeding
`areaPositions`. Greyson's Room → `greysons_room` etc.

## Phase A — Room snap + click-to-place editor

**Goal**: Orb lands at a user-defined `(x, y, z)` for the room HA reports.
"Where is the kitchen in my 3D scene" is a one-time setup per tracker per
room. Same UX feel as placing a light.

**Files to modify**:

1. `src/babylon/TrackerMeshFactory.ts`
   - Add `normalizeAreaKey(s)` helper, exported.
   - Update `targetForArea()` to call `normalizeAreaKey()` on the input and
     also tolerate exact-match (back-compat with manually-tuned configs).
   - Keep all other exports unchanged.

2. `src/pages/Dashboard/Dashboard.tsx`
   - In `autoDiscoverTrackersFromStates`, change the default `areaPositions`
     keys to normalized form. Don't worry about adding more room defaults —
     normalization is the actual fix.
   - Existing `onStateChanged` + `onInitialStates` already call
     `targetForArea` so they'll automatically benefit.

3. `src/types/index.ts`
   - No type changes needed. `areaPositions: Record<string, LightPosition>`
     already allows any key.

4. **NEW**: `src/components/TrackerForm.tsx` + `src/components/TrackerList.tsx`
   - Pattern: mirror `LightForm.tsx` + `LightList.tsx` in the same directory.
     LightForm has the canonical pattern: name, entity picker, x/y/z inputs,
     "Pick from scene" button that puts the camera in a special click-to-place
     mode.
   - Tracker editor fields:
     - Label (text)
     - Entity ID (existing entity picker for `device_tracker.*`)
     - Area entity ID (existing entity picker for `sensor.*_area`)
     - Color, diameter, glow (number inputs)
     - **Per-room position list**: rows of `area_id` → (x,y,z), each with
       "Pick from scene" + "Delete" buttons + an "Add Room" button to insert
       a new row with empty area_id.
     - "Default position" for fallback when area unknown (use cfg.position).

5. `src/components/SidePanel/SidePanel.tsx` and any tab navigation
   - Add a new tab "Trackers" alongside the existing Lights / Displays / Tubes
     tabs. Reuse the SidePanel tab pattern.

6. `src/pages/Dashboard/Dashboard.tsx` integration
   - When TrackerForm dispatches a save, persist via `updateConfig({ trackers })`
     (already wired) and reconcile meshes:
     - If new tracker → `createTrackerMesh(scene, cfg)`, add to `trackerMapRef`
       + `trackerAreaToEntityRef`.
     - If existing tracker config changed → dispose & recreate, OR mutate the
       mesh in place (color/diameter changes can be live-applied without dispose;
       position changes use `setTrackerPosition` to snap or `animateTrackerTo`
       to ease).
     - If tracker removed → `removeTrackerMesh`.

7. **Click-to-place mode** (the key new UX piece)
   - Need a way for the TrackerForm to enter a mode where the next click on
     the 3D scene picks an (x, y, z) from the ground intersection.
   - Look for existing "Pick from scene" in `LightForm.tsx` — it likely uses
     a scene observable on `pointerdown` that resolves the camera's pick ray
     against the floor mesh and returns the world position. Reuse exactly.
   - If LightForm has no such helper, build one in `src/babylon/`:
     `enterPickMode(scene, callback)` — returns a `cancel()` function. The
     callback receives `{ x, y, z }` and the mode auto-exits after first click.
     Highlight the floor (yellow tint? cursor change?) while in pick mode.

**Test plan (Phase A)**:

a. **Build passes**: `cd E:\GitHub\3Dash_webapp && npm run build -- --mode addon`
   succeeds with no TS errors.
b. **Existing functionality intact**: After deploy, the existing 7
   auto-discovered trackers still appear as glowing spheres.
c. **Normalization works**: with no manual config changes, Daniel's green orb
   moves to roughly the `(2, 1.2, 2)` default Dining Room position (because
   `sensor.daniel_s_iphone_area` returns `"Dining Room"` → normalized to
   `dining_room` → matches default).
d. **Editor renders**: a new "Trackers" tab appears in the side panel. Clicking
   it shows the 7 trackers with "Edit" buttons.
e. **Click-to-place works**: open Daniel's tracker → pick Dining Room row →
   "Pick from scene" → click somewhere on the floor → coordinates populate the
   row → save → orb visibly jumps to the picked spot.
f. **Persistence**: reload the page. Picked position is still there. Orb still
   reports correct area-based position.

How to validate via Chrome MCP after a deploy:

```
navigate_page → https://192.168.1.10:8443/
evaluate_script → check localStorage["config"].trackers[*].areaPositions
                  is keyed by normalized slugs (no spaces or capitals)
list_console_messages → look for `[3Dash][tracker]` lines
take_screenshot → visually confirm orbs are inside rooms
```

How to validate the orb actually responds to area updates:

```
HA REST: POST /api/services/input_text/set_value to fake an area state change
(or just wait for natural movement). Then check console for animateTrackerTo
log line, or evaluate_script to read the sphere's current Vector3 position.
```

## Phase B — BLE-informed continuous positioning

**Goal**: Orb moves continuously *within* a room, drifting toward whichever
scanner it's nearest, rather than snapping to a fixed centroid.

**Pre-flight: discover the actual Bermuda data shape.**

Right now we know `sensor.<phone>_distance` returns *one* number — distance to
closest scanner. We don't yet know if Bermuda exposes per-scanner distance
as entities or only via its WS API. Before writing code, do this discovery:

```python
# Hit HA WS api/websocket, subscribe to 'bermuda/dump' or 'bermuda/state', or
# scan entity registry for sensor entities containing both a phone slug and
# an anchor MAC. Bermuda may expose hidden 'sensor.<phone>_distance_to_<mac>'
# entities (disabled by default) that you can enable via entity registry.
```

If Bermuda doesn't expose per-anchor distance:
- Fallback: parse Bermuda's `bermuda.dump_devices` service response which
  returns full per-device state including all scanners + their RSSI.
- Or fall back to using just the single `distance` + `area` sensors and
  doing room-centroid + small randomized offset (less impressive but ships).

**Files to modify (assumes per-anchor distance is available)**:

1. `src/types/index.ts`
   - Add `AnchorConfig`:
     ```ts
     export interface AnchorConfig {
       deviceId: string;       // HA device_id of the ESPHome anchor
       label: string;
       position: LightPosition;
     }
     ```
   - Add `anchors?: AnchorConfig[]` to `AppConfig` + `FullConfig`.
   - Add `distanceToAnchor?: Record<deviceId, string>` to TrackerConfig — maps
     anchor deviceId → the HA entity that holds distance from this tracker to
     that anchor.

2. **NEW**: `src/babylon/AnchorMeshFactory.ts`
   - Renders anchors as small static markers in the 3D scene (different shape
     from trackers, e.g., a low cone or pin).
   - Optionally render the distance sphere around each anchor when a tracker
     is "near" it (visual debug).

3. **NEW**: `src/components/AnchorForm.tsx` + `src/components/AnchorList.tsx`
   - Same UX as TrackerForm but for anchors. Click-to-place reuses the same
     `enterPickMode` helper.

4. `src/pages/Dashboard/Dashboard.tsx`
   - Subscribe to per-anchor distance entities for each tracker.
   - On state update, compute weighted-centroid:
     ```ts
     const total = anchors.reduce((sum, a) => sum + 1 / Math.max(distances[a.deviceId], 0.5), 0);
     const pos = anchors.reduce((acc, a) => {
       const w = 1 / Math.max(distances[a.deviceId], 0.5);
       return { x: acc.x + a.position.x * w / total, y: acc.y + a.position.y * w / total, z: acc.z + a.position.z * w / total };
     }, { x: 0, y: 0, z: 0 });
     ```
   - Clamp `y` to the tracker's default sphere height so orbs don't sink into
     the floor or float at the ceiling. (For Phase B, y is purely cosmetic.)
   - Smooth: lerp toward the new computed position at 5 Hz (animation interpolates).

**Test plan (Phase B)**:

a. Open the dashboard with 6 anchors placed at known positions in your Polycam
   scene (Master Bedroom, Greyson's Room, Keek's Bedroom upstairs; Voice +
   Kiosk + Button Box downstairs).
b. Walk around with phone. Watch the orb glide smoothly toward whichever
   anchor it's closest to.
c. Visual: drift, not snap. The orb should NEVER be exactly on top of an
   anchor unless `distances[i] → 0`.

## Phase C — Real trilateration + Kalman filter

**Goal**: Solve actual 3D position from ≥3 anchors with measured distances,
plus a Kalman filter to dampen sensor jitter.

This is multi-session work. Key components:

1. Trilateration solver — Gauss-Newton least-squares with damped Levenberg-
   Marquardt. Inputs: anchor positions + measured distances + initial guess.
   Output: (x, y, z) + residuals.
2. Kalman filter — 3D constant-velocity model. State = [x, y, z, vx, vy, vz].
   Measurement = trilateration output. Tune Q (process noise) and R
   (measurement noise) empirically.
3. Confidence visualization — render a translucent ellipse around the orb
   when measurement uncertainty > threshold.

Defer the implementation specs until Phase B is shipped. The data plumbing
established in Phase B is the prerequisite.

## Multi-floor support (cross-cutting — applies to A, B, C)

The house has multiple floors. Bermuda already detects floor: HA reports
`sensor.<phone>_floor` as `"Main"` or `"Upper"`. Phase A/B/C must respect this.

**Phase A multi-floor**:
- `AreaPositions[<area_id>] = {x, y, z}` — `y` differs by floor.
  Suggested convention: Main floor y ≈ 1.2 m, Upper floor y ≈ 4.0 m
  (~3m floor-to-floor + 1m head height). User picks the actual y when
  click-placing each room.
- 3Dash GLB today is downstairs-only. When user adds an upstairs GLB (or
  combined model), the click-to-place naturally captures the right y because
  ray-pick against upstairs floor returns upstairs y. No code change needed
  beyond making sure picks aren't clamped to a single floor.
- If only downstairs is modeled, render upstairs rooms as floating markers
  at a chosen height — show a "no model for this floor" placeholder.

**Phase B multi-floor**:
- Add `floor: string` to `AnchorConfig` (`"Main"` / `"Upper"` matching HA).
- When computing weighted centroid for a tracker, **first filter anchors by
  `sensor.<phone>_floor`**: only include anchors on the reported floor.
  Fallback: if the phone's floor is `"unknown"`, include all anchors.
- This single rule handles attenuation implicitly — we just don't trust
  cross-floor signals at all in the centroid.

**Phase C multi-floor** (real trilateration):
- Per-anchor distance computation uses Bermuda's already-attenuation-aware
  estimate, so we don't have to add the ~10-15 dB per-floor penalty ourselves
  *if we trust Bermuda's distance values*. But cross-floor RSSI is unreliable
  (signal scatters through joists / HVAC ducts). Recommended:
  1. Use `sensor.<phone>_floor` as the primary floor hint.
  2. In the least-squares solver, weight anchors by `1.0` if same-floor,
     `0.1` if different-floor — soft penalty rather than exclusion.
  3. Constrain the solver's `z` (or `y` if Babylon convention) to the floor
     band reported by Bermuda. e.g. if floor=Main, solve only in
     `y ∈ [0.0, 2.5]`.

**Polycam scan plan**:
- User currently has Main-floor GLB only.
- Future task: scan upstairs with Polycam, then either:
  - Load two GLBs (one per floor) and stack them in Babylon at correct y.
  - Combine into one GLB in Blender with both floors visible.
- 3Dash should support either model. The `Mapping` config UI gets a "floor"
  selector when picking room positions.

## Phase UI — HA-embed-friendly chrome

**Goal**: When 3Dash is embedded in HA Lovelace, it should NOT show its own
"3DASH · LIVE VIEW" header, settings cog button, or any chrome that looks
like a standalone app.

**Detection**:
```ts
const isEmbedded = window !== window.top || new URLSearchParams(window.location.search).has('embed');
```

**Files to modify**:
- `src/components/HUD.tsx` — when `isEmbedded`, hide the top banner.
- `src/components/SidePanel/SidePanel.tsx` — when `isEmbedded`, render the
  settings gear smaller, in a corner, or hide entirely if `?embed=1&readonly=1`.
- Add CSS class `body.embedded` toggle for styling overrides.

**Test plan**:
- Visit https://192.168.1.10:8443/ — full UI present
- Visit https://192.168.1.10:8443/?embed=1 — header hidden
- View through HA iframe — header hidden (detected via window.top)

## Phase Mobile — responsive layout + touch

**Goal**: Works on iPhone Safari + HA Companion App on mobile.

**Likely fixes**:
- Add `<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">` if missing.
- Set Babylon canvas to fill viewport with proper devicePixelRatio.
- SidePanel becomes a bottom-sheet at narrow widths (`@media (max-width: 768px)`).
- Pinch + drag camera gestures (Babylon supports them via ArcRotateCamera
  pointer input by default — verify).
- Test on iOS Safari + HA Companion App.

## Test infrastructure

Every phase should preserve:
- TypeScript builds clean
- No console errors on dashboard load
- The 7 auto-discovered trackers continue to render with correct colors
- HA WebSocket connection stays up

Smoke test script (PowerShell, run after each deploy):
```powershell
$tok = 'eyJhbGciOi...'
$h = @{Authorization="Bearer $tok"}
curl -sk -m 5 -H "Authorization: Bearer $tok" "https://ha.shuehome.net/api/" | Out-String
# Open dashboard
# Verify console clean
```

For Chrome MCP verification:
- Always reload with cache bypass after a deploy (Portainer rebuild)
- Check console.errors are empty
- Run `evaluate_script` on Babylon scene to count meshes and check positions
- Take screenshot for visual confirmation

## Deploy loop

1. Implement in `E:\GitHub\3Dash_webapp` on `dev` branch
2. `git add . && git commit -m "feat(phase-X): description"`
3. `git push origin dev`
4. Wait ≤ 5 min for Portainer auto-rebuild (poll Portainer API or just wait)
5. Hard-reload https://192.168.1.10:8443/ in Chrome MCP
6. Run validation script
7. If validation fails: diagnose, fix, repeat. Commit per fix (atomic).

## Where to stop

End each phase by:
1. Committing all changes with a descriptive message
2. Pushing to dev
3. Verifying the deployed change works
4. Writing a one-paragraph status to `E:\GitHub\3Dash_webapp\docs\PHASE-LOG.md`
   that records what shipped and what's known to be working/broken
