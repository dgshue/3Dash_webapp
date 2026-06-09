# 3Dash — Documentation

## Getting started

This add-on uses Home Assistant **ingress**, so 3Dash is served under HA's
own URL and certificate. The big win: it works in the HA **Companion App**
on iOS / Android — no self-signed-cert workarounds needed.

After installing and starting the add-on:

1. Open the **3Dash** entry in HA's left sidebar (panel icon: floor-plan).
2. Click **Open Web UI** if you prefer a separate tab.
3. The onboarding wizard runs the first time you open it:
   - **No access token needed** — under ingress the add-on relays the HA
     WebSocket with its own Supervisor credentials, so the connection
     authenticates automatically.
   - Lat/lng for sun tracking.
   - Upload a `.glb` 3D model of your home.

There is **no host port** exposed. All traffic flows through HA's ingress
proxy, so there is no certificate warning and it works in the Companion App.

## BLE positioning (this fork)

This fork adds real-time BLE positioning of family iPhones inside the 3D
scene. Workflow once the add-on is running:

1. Make sure Bermuda + Private BLE Device integrations are configured
   in HA and resolving your phone(s) by IRK.
2. Open 3Dash → click the 📍 icon (top-right) to open the **Anchors**
   panel.
3. For each unplaced anchor (shown with red badge): click **Place**,
   then click on the 3D model where the BLE scanner physically lives.
4. (Optional) Click **Calibrate** to capture fingerprints at known
   spots — once you have 5+, k-NN positioning kicks in and beats
   trilateration in homes with walls / multipath.

The `/editor` route exposes per-anchor **Calibration (advanced)**
settings: `refPower`, `pathLossExp`, `antennaGainDbi`, `trustWeight`.

## Configuration

All configuration happens in the browser — no files to edit manually.

| What | Where |
|---|---|
| Home Assistant connection | Onboarding wizard or Settings |
| Location (for sun tracking) | Onboarding wizard or Settings |
| Theme, rendering, camera | Settings modal |
| Lights, displays, shadow walls, tubes | Config editor |
| Anchors, trackers, calibration | Dashboard 📍 panel + `/editor` Anchors tab |

## Backup and restore

Export your full configuration (lights, displays, settings, 3D model)
as a ZIP from the settings panel, including calibration fingerprints.
Under ingress, your settings and 3D model are also persisted server-side
in the add-on's `/data` directory, so they survive add-on updates and
browser/kiosk resets automatically.

## Support

Fork repository: <https://github.com/dgshue/3Dash_webapp>.
Upstream: <https://github.com/kdcius/3Dash_webapp>.
