# 3Dash

A 3D floorplan dashboard for Home Assistant. Load your own 3D model, map it to your smart home entities, and control everything from an interactive view in your browser. This fork adds real-time BLE positioning of family devices with calibration.

## How to access

This add-on is served through Home Assistant **Ingress**, so once it's running just open **3Dash** from the HA left sidebar (or **Open Web UI**). It also works in the HA **Companion App** on iOS / Android.

There is **no host port to open**, no IP to type, and **no certificate warning** — all traffic flows through HA's own URL and certificate.

You don't need a long-lived access token, either: under Ingress the add-on relays the Home Assistant WebSocket using its own Supervisor credentials, so the browser authenticates automatically.

## Features

- 3D floorplan with custom `.glb` models
- Real-time BLE positioning of devices with 3-tap calibration (Bermuda / Private BLE)
- Light control (on/off, dimmable, RGB, RGBW, IR remote)
- Wall displays with live sensor data
- Animated network throughput tubes
- Real-time sun positioning and weather effects
- Configurable side panel with scripts, indicators, and graphs
- Built-in config editor and onboarding wizard
- Tokenless connection under Ingress — no long-lived token required
- Durable configuration — settings and 3D model persist across add-on updates
- Backup and restore
- Dark and light themes
