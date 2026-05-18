# BLE Positioning — Phase Log

## Phase A — Room snap + click-to-place editor (2026-05-18)

**Shipped.** Two atomic commits on `dev` (`0587fad` fix, `78e5a12` feat),
both pushed and auto-redeployed via Portainer stack 157 in under a
minute. Verified via Chrome DevTools MCP against
https://192.168.1.10:8443/#/editor — the new **Trackers (7)** tab renders
alongside Lights/Displays/Walls/Tubes, lists every auto-discovered
device with its color dot + entity id + room count, and the "+ Add
Tracker" footer button shows the new TrackerForm. The form has identity
(device_tracker + sensor.*_area entity pickers), appearance
(color/diameter/glow), a per-room positions accordion with add/delete
rows and "Pick this row from scene" buttons, and a separate default
position. Click-to-place reuses ConfigEditor's existing
`enterPlacingMode` / `exitPlacingMode` plumbing — added a tracker
branch in the `onPointerDown` handler that writes the picked point
verbatim (no y-clamping, so picking the upstairs floor yields upstairs
y for multi-floor scenes). The area-key normalization bug is fixed:
`normalizeAreaKey()` is now exported from `TrackerMeshFactory.ts` and
`targetForArea()` tries exact match → normalized match → key-by-key
normalized scan, so `"Dining Room"` from HA now resolves to the
`dining_room` slot. Dashboard auto-discovery defaults gained three
upstairs rooms (`master_bedroom`, `greysons_room`, `keeks_bedroom`) at
y ≈ 4.0 alongside the existing downstairs rooms at y ≈ 1.2. **Known
caveat**: existing localStorage configs (the user's 7 trackers were
auto-discovered before this fix) still contain only the 5 downstairs
defaults — to pick up the upstairs keys they must either delete the
tracker config to re-trigger discovery, or use the new editor to add
upstairs rows manually. Daniel's iPhone is currently in "Keek's
Bedroom" (HA reports floor=Upper) — the fix verifies
`normalizeAreaKey("Keek's Bedroom") === "keeks_bedroom"` matches the
new default. TS build: clean. Phase B (per-anchor distance / weighted
centroid) is the natural next step.

## Phase B — Bermuda data discovery (2026-05-18)

**Bermuda per-anchor distance is NOT exposed as HA entities.** Probed
the live HA at https://ha.shuehome.net/api/states — there are no
`sensor.<phone>_distance_to_<anchor>` entities, disabled or otherwise.
Only `sensor.<phone>_distance` (closest scanner) and
`sensor.<phone>_estimated_distance` exist.

**The data IS exposed via the `bermuda.dump_devices` service.** Call
it with `return_response: true` (REST: POST `/api/services/bermuda/dump_devices?return_response=true`;
WS: `{type: 'call_service', domain: 'bermuda', service: 'dump_devices',
return_response: true}`). Response shape under `service_response`:

```
service_response[<phone_unique_id>] = {
  name, address, area_name, floor_id, floor_name,
  adverts: {
    "<scanner_mac>__<phone_mac>": {
      scanner_address, area_name (anchor's area),
      rssi, rssi_distance_raw,        // raw single-shot distance (m)
      hist_distance: [...10 floats],   // recent distance history
      hist_distance_by_interval: [...] // smoothed
    },
    ...one entry per scanner that's seen this device...
  }
}
```

**Currently 3 anchors are configured in Bermuda** (not 6 as the plan
optimistically assumed): Greyson's Room Anchor (`e0:72:a1:d5:27:a6`,
upstairs), Master Bedroom Anchor (`e0:72:a1:d5:0f:92`, upstairs),
Keek's Bedroom Anchor (`ac:a7:04:e2:f2:9a`, upstairs). All 3 are
upstairs — there are no downstairs Bermuda scanners yet. Daniel's
phone (`81b59d42ea7d2eb03236b7c51061f7e8`) currently sees ~7 advert
sources including the 3 anchors, with `rssi_distance_raw` ranging
2–14 m. Phone uses `floor_name: "Main"`.

**Data path chosen for Phase B**: poll `bermuda.dump_devices` on a
~3-second interval via the existing HA WS connection (`request()`
helper already supports arbitrary messages). For each tracker config
with a `distanceEntities` map populated, read per-anchor distance from
`service_response[<phone_id>].adverts[<scanner>__<phone_mac>].rssi_distance_raw`.
**Phone lookup**: match by `name` (case-insensitive substring of the
tracker label) since the phone's unique id in dump_devices is opaque
and unrelated to its HA `device_tracker.*` entity_id.

For Phase B's auto-discovery of anchors, we read the same dump and
filter on entries where `name` contains "anchor" (the user's naming
convention — all 3 current anchors are literally named "X Anchor").
We don't filter on `is_remote_scanner` because Bermuda sets that
based on its internal scanner registry, which proves unreliable here.

## Phase B — Implementation shipped (2026-05-18)

**Commit**: `6f2d761` (`feat(phase-b): anchors, multi-floor centroid, upstairs backfill`)
pushed to `origin/dev`. Portainer stack 157 redeploy returned HTTP 200.

**Files changed**:
- `src/types/index.ts` — added `AnchorConfig` (deviceId/label/position/floor),
  `anchors?` on `AppConfig` + `FullConfig`, `distanceEntities?` on `TrackerConfig`.
- `src/babylon/AnchorMeshFactory.ts` — NEW. Cyan cone "pin" mesh
  (`createAnchorMesh`, `setAnchorPosition`, `setAnchorVisible`,
  `setAnchorDebugRadius`, `removeAnchorMesh`, `disposeAllAnchors`).
- `src/components/AnchorList.tsx` + `src/components/AnchorForm.tsx` — NEW.
  Mirror the Tracker form pattern: deviceId, label, floor (Main / Upper /
  Other…), position with "Pick from scene" reusing existing pick mode.
- `src/pages/ConfigEditor/ConfigEditor.tsx` — added Anchors tab + state,
  handlers (add/edit/delete/duplicate/save), placing-mode branch, and a
  rebuildAnchorEditorMeshes flow tied to the tab switch.
- `src/pages/Dashboard/Dashboard.tsx` — added BermudaDevice/Advert types,
  anchor mesh render on init, upstairs-defaults backfill block (writes
  via `updateConfig` once on load if `master_bedroom` / `greysons_room` /
  `keeks_bedroom` are missing on any existing tracker), `sensor.<phone>_floor`
  caching in `onStateChanged`, and a 3 Hz `bermuda.dump_devices` poll wired
  through `ha.request({ type: 'call_service', return_response: true })`.
  The poller (a) auto-discovers anchors (filters `name ~= /anchor/i`,
  stacks at origin), (b) builds `trackerDistancesRef[<tracker>] =
  {anchorDeviceId: meters}` from each `adverts[<scanner>__<phoneMac>].rssi_distance_raw`,
  (c) filters anchors by `phoneFloor` (Bermuda's `floor_name`), (d) computes
  inverse-distance-weighted centroid `1/max(d, 0.5)`, (e) animates the
  tracker via `animateTrackerTo` throttled to 5 Hz per tracker.
- `src/services/configApi.ts` — added `anchors?` to the `updateConfig` payload.

**Build**: `npm run build -- --mode addon` clean (1m21s). No TS errors.

**Deployment**: Portainer redeploy triggered immediately after push.

**Known limitations**:
- Only 3 anchors currently exist in the user's Bermuda registry (all
  upstairs). Plan optimistically expected 6 (3 down + 3 up); auto-discovery
  picks up whatever Bermuda reports. Downstairs anchors will appear when
  the user adds new ESPHome devices with "Anchor" in the name.
- Bermuda phone-entry matching is by label-substring (case-insensitive),
  since Bermuda's internal IRK keys are opaque and don't correspond to HA
  `device_tracker.*` entity_ids. The tracker label must contain or equal
  the phone's Bermuda name (e.g. `"Daniel's iPhone"`). For Daniel, this
  works because his tracker label was auto-set from the device_tracker
  friendly_name which matches Bermuda's name.
- Daniel's existing orb behavior is preserved: the area-snap path in
  `onStateChanged` still fires on `sensor.daniel_s_iphone_area` updates,
  so when the centroid path has no data the area-snap still drives him
  to Dining Room as before. The 5 Hz throttle on centroid updates makes
  centroid + area updates coexist without queue bloat — whichever fired
  last wins.
- The poller assumes `bermuda.dump_devices` exists. If the user removes
  the Bermuda integration, the poll logs a warning every 3 s but is
  otherwise harmless.
- Verifying that subscriptions actually fire requires the user (or an
  active phone) to be in BLE range of an anchor; the poll loop logs only
  warnings, not successes, so check Chrome devtools console for
  `[3Dash][anchor] auto-discovered N anchors from bermuda.dump_devices`
  after first deploy reload.

**What's left for Phase C**:
- Real least-squares trilateration solver (vs the current centroid heuristic).
- Kalman filter for sensor jitter dampening.
- Confidence ellipsoid visualization when measurement residual is high.
- Z-band constraint per `sensor.<phone>_floor`.
- UI toggle for `setAnchorDebugRadius` (translucent sphere visualization
  of measured distance — code path exists, no UI yet).
- Phase B currently uses `rssi_distance_raw`; consider switching to the
  smoothed `hist_distance_by_interval` mean for steadier orbs.



## Phase B — Fix-up: restore bermudaApi service (2026-05-18)

**Shipped.** Commit `7b17def` on `dev`, pushed to origin. The Phase B
commit (`6f2d761`) imported from `src/services/bermudaApi.ts` in
Dashboard.tsx but never committed the file itself, leaving origin/dev's
build broken (`npm run build -- --mode addon` failed module resolution).
Restored the missing service module as a properly typed wrapper around
the WS `call_service bermuda.dump_devices` (`return_response: true`)
call. Exports `dumpBermudaDevices()`, `parseBermudaDump()`, and
`findTrackerEntityForBermuda()`.

**Bermuda data shape (verified live against ha.shuehome.net)**: the
service response is keyed by device address — IRK (32-hex) for
phones-via-private_ble_device, real MAC for ESPHome scanners (anchors
where `_is_scanner === true`). Per-tracker per-scanner distance lives
in `device.adverts[<sourceMac>__<scannerMac>]` with `rssi_distance`
(Kalman-filtered, preferred) falling back to `rssi_distance_raw`. A
single phone IRK emits adverts through several rotating source MACs
(metadevice_sources); we aggregate per scanner by min distance. Each
tracker also carries `floor_name` ("Main" / "Upper") and `area_name`,
duplicating `sensor.<phone>_floor` and `sensor.<phone>_area`.

**Dashboard cleanup** in the same commit: dropped the in-file
`BermudaAdvert` / `BermudaDevice` scaffold types, tightened the
weighted-centroid filter to do case-insensitive floor compare, require
≥ 2 same-floor anchors with distance before filtering (falls back to
all anchors-with-distance when the same-floor count is too thin so the
orb still drifts), slowed the poll from 3 s to 5 s per the Phase B spec,
and added a one-line debug log per poll. Build clean.

## Phase UI — HA-embed-friendly chrome (2026-05-18)

**Shipped.** When 3Dash is iframed in HA Lovelace OR loaded with
`?embed=1`, the standalone app chrome (top "3Dash · Live View" banner,
clock/date, four HUD corners) is hidden and the prominent "Settings"
row in the side panel collapses to a small low-opacity floating
button in the bottom-right (functionality preserved — power users can
still hit it, or use `?embed=0` to force the full UI).

Detection is `src/utils/embedMode.ts::isEmbedded()`: tries
`window !== window.top` (cross-origin throws → also treated as
iframed), respects `?embed=0`/`?embed=1` overrides. App.tsx applies
the `body.embedded` class on mount via `applyEmbedBodyClass()`. All
visual hiding is CSS-only in `App.css` so HUD.tsx / SidePanel.tsx
remain unmodified — easier to merge with parallel phase work.

Build clean (`npm run build -- --mode addon`). Standalone
https://192.168.1.10:8443/ keeps full chrome; `?embed=1` and the
HA iframe path both hide it.

## Phase UI — Readonly embed follow-up (2026-05-18)

**Shipped.** Adds `?readonly=1` (or `?readonly`) URL param support to
the embed flow. When present, the floating gear button is hidden
entirely so HA Lovelace iframe viewers can't open the Settings modal
or reach config editing surfaces. Standalone (`?embed=0` or no params)
and embed-without-readonly remain unaffected.

**Changes**:
- `src/utils/embedMode.ts` — new `isReadonly()` helper following the
  same `?readonly=0/false` opt-out semantics as `isEmbedded()`.
  `applyEmbedBodyClass()` now also toggles a `body.embedded-readonly`
  class and the returned cleanup fn removes both classes.
- `src/App.css` — single new rule `body.embedded-readonly
  .side-panel-settings-btn { display: none !important; }` hides the
  gear when readonly is requested. Standalone-only viewers never see
  either class so behavior is unchanged.

**Matrix**:
- https://192.168.1.10:8443/ → full chrome (banner, HUD corners, gear row).
- https://192.168.1.10:8443/?embed=1 → banner/HUD hidden, gear collapsed
  to floating bottom-right corner button.
- https://192.168.1.10:8443/?embed=1&readonly=1 → banner/HUD hidden, gear
  hidden entirely.
- HA iframe (`window.top` check) → same as `?embed=1`; combine with
  `&readonly=1` in the Lovelace iframe card URL for view-only mode.

Build clean (`npm run build -- --mode addon`).

## Phase Mobile — responsive layout + touch (2026-05-18)

**Shipped.** Fixes the "doesn't pull up on mobile" report by ironing
out the iOS Safari + HA Companion App gotchas. No JS/TSX changes
needed — viewport meta was already in `index.html`
(`width=device-width, initial-scale=1.0, viewport-fit=cover`),
`SceneManager.createScene` already caps `setHardwareScalingLevel(1/
min(devicePixelRatio, 2))` to keep HiDPI cost sane, the dashboard
already flips to flex-column under 768px with the canvas on top and
the side panel as a bottom sheet, and Babylon's `ArcRotateCamera`
already gets `attachControl(canvas, true)` with pinch + drag.

**What was actually broken (CSS-only fixes)**:
- `src/App.css` — `body` was `width: 100vw; height: 100vh; overflow:
  hidden;` but lacked `position: fixed`, so iOS rubber-band scroll
  could drag the page out from under the canvas on first load. Now
  pinned via `position: fixed; inset 0; overscroll-behavior: none;
  -webkit-tap-highlight-color: transparent`. `#root` uses `100dvh`
  with `100%` fallback (and `html { height: -webkit-fill-available }`
  for old iOS Safari) so the layout sizes to the visible viewport
  when the URL bar collapses/expands.
- `src/pages/Dashboard/Dashboard.css` — canvas already had
  `touch-action: none`; added `user-select: none` and
  `-webkit-touch-callout: none` to suppress iOS magnifier / callout
  on long-press, which was eating ArcRotateCamera drag gestures.
- `src/components/SidePanel/SidePanel.css` — added `touch-action:
  none` to the resize handle (otherwise iOS tried to scroll the
  locked page instead of letting React's pointer handler resize the
  panel), bumped mobile handle hit area to 24px, bumped action
  buttons (Settings / Add Card / Done / Exit Simulation) to a 44px
  iOS-recommended tap target, and added
  `padding-bottom: env(safe-area-inset-bottom)` so the home indicator
  doesn't clip controls.
- `src/components/HUD.css` — replaced fixed 8/16/18px top/left/right
  values with `max(N, env(safe-area-inset-*))` on mobile so the
  title bar, clock, and corner brackets clear the notch on iPhone X
  and newer.
- `src/components/FormPanel/FormPanel.css` — the 450px right drawer
  pushed off-screen on a 414px iPhone. Now becomes a bottom sheet
  under 768px (`top: auto; right: 0; left: 0; bottom: 0; width:
  100%; max-height: 80dvh; transform: translateY(100%)` slides up
  from the bottom) with a 44px close button and safe-area padding.

**Build**: `npm run build -- --mode addon` clean. No TS errors.

**Service worker note**: `vite-plugin-pwa` with `registerType: 'autoUpdate'`
+ `registerSW({ immediate: true })` should self-update on next load.
If a user's iPhone has an aggressively-cached pre-fix SW they may need
to force-reload once (PWA install screen → remove, or in Safari:
Settings → Safari → Advanced → Website Data → remove
192.168.1.10). Not blocking; logged here for follow-up.

**Verification**: Desktop layout unchanged (all mobile rules gated
`@media (max-width: 768px)`). Mobile breakpoints fire under iPhone
sizes (Chrome DevTools device toolbar @ 414×896 confirms the side
panel renders as a bottom sheet, HUD respects safe-area, and the
canvas fills the remaining viewport).

## Phase C — Trilateration + Kalman (2026-05-18)

**Shipped.** Two commits on `dev`: `3b8473a` (Job 1 anchor-discovery
merge fix, pre-work) plus the Phase C feature commit, both pushed and
Portainer-redeployed via stack 157.

**Job 1 — anchor auto-discovery (PRE-WORK)**: Phase B was one-shot —
if any anchors were already saved, discovery skipped entirely. Users
who shipped Phase B with 3 upstairs anchors never picked up the 4
downstairs scanners. Switched to a MERGE strategy that appends every
`_is_scanner === true` entry not already in `config.anchors`, stacked
at origin. Verified live against
`POST /api/services/bermuda/dump_devices?return_response=true` (empty
JSON body, not `{return_response:true}` — that returns 400): 7
scanners reported — Greyson's Room Anchor, Master Bedroom Anchor,
Keek's Bedroom Anchor (Upper); Tower BLE Adapter, Home Assistant
Voice 0905ac, Button Box, RuView Kiosk (Main). The existing
`bermudaApi.parseBermudaDump` already filters on `_is_scanner` (no
substring filter), so no service-layer change needed — just the
Dashboard's discovery loop.

**Job 2 — `src/babylon/Trilateration.ts` (NEW)**: damped Gauss-Newton
(Levenberg-Marquardt) 3D least-squares. Minimizes
`Σ wᵢ (‖P − Aᵢ‖ − dᵢ)²` via diagonal LM damping (Marquardt's
scale-aware variant), Cramer-style 3x3 Gaussian elimination with
partial pivoting, accept/reject step with λ shrink (×0.1) on
improvement and grow (×10) on worsening, optional y-band clamp per
floor. Stops on `‖Δ‖ < 0.05 m` or 20 iterations. Requires ≥3 valid
distances; under-determined → returns the warm start unchanged with
`converged=false` so callers can fall back to centroid. Exports
`solveTrilateration(anchors, initialGuess, floorBand?)`.

**Job 3 — `src/babylon/PositionKalman.ts` (NEW)**: 6-state
constant-velocity Kalman (`[px,py,pz,vx,vy,vz]`). Hand-rolled 6x6/3x3
matrix math on `Float64Array` — no deps. `predict(dt)` exploits the
structured `F = [[I, dtI],[0, I]]` to touch only the cells that
change. `update(z, residualMeters)` maps the trilateration residual
to per-axis measurement σ (clamped 0.5 .. 8 m) so high-residual
solves auto-smooth more. Symmetrizes P after each update to absorb
round-off. `getState()` returns position + velocity + position-σ for
a future confidence ellipsoid.

**Job 4 — wiring (`Dashboard.tsx`)**: 3 Hz poll → for each tracker
matched via `findTrackerEntityForBermuda`: filter same-floor anchors,
compute weighted-centroid warm start (cross-floor weighted 0.1),
call `solveTrilateration` with y-band `[0,2.5]` Main / `[3.0,5.5]`
Upper, feed `result.position` + `result.residual` into per-tracker
`PositionKalman` (lazy-init on first solve, predict+update on
subsequent), animate to `kf.getState().position` at the existing 5 Hz
throttle. Three-tier degradation:
  - ≥3 same-floor anchors → trilateration + Kalman (primary path)
  - 1–2 anchors → weighted-centroid (smoothed through Kalman if alive)
  - 0 → fall through to area-snap path (unchanged)
Cleanup clears the per-tracker Kalman / distance / floor / last-solve
refs alongside mesh disposal.

**Job 5 — confidence ellipsoid**: deferred. Variance is exposed via
`kf.getState().positionVarianceTrace` for a future pass; mesh
rendering wasn't added in this commit.

**Build**: `npm run build -- --mode addon` clean (~2 min).

**Caveats / remaining**:
- All 7 scanners auto-discovered, but the 4 newly-merged downstairs
  anchors are stacked at origin — user must click-to-place them in
  the Anchors tab before trilateration becomes meaningful for Main-
  floor phones. Until then, the Main-floor solve degenerates to a
  degenerate cluster and Kalman smoothing hides most of the jitter.
- Kalman σ_pos=0.1, σ_vel=0.5 are conservative defaults. Tune
  empirically once anchors are placed and orbs are observed walking.
- Distance metric is still Bermuda's `rssi_distance` (filtered) with
  `rssi_distance_raw` fallback. `hist_distance_by_interval` median
  may be steadier — not adopted in this pass.
- Trilateration uses a soft cross-floor penalty (weight 0.1) rather
  than hard exclusion, so a phone briefly straddling floors should
  glide rather than teleport.
- Confidence ellipsoid (Job 5) and a UI toggle for
  `setAnchorDebugRadius` remain on the followup list.
