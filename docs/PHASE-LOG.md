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
