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

