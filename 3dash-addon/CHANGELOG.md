# Changelog

## 1.4.1

**UI cleanup for tokenless Ingress.**

- Settings → Connection hides the HA URL/port/token fields under Ingress and
  shows a "Connected via Ingress" status instead (fields remain for the
  standalone web build).
- Onboarding skips the Home Assistant token step under Ingress.
- Collapsed the Live / Demo / Simulation modes into one user-facing concept:
  **Live** vs **Demo** (the bundled sample home is just "Demo" now).
- Terminology: "Edit Scene" → "Editor", "Edit Grid" → "Edit Panel", and the
  editor's back button reads "← Back".
- Fixed indicator/display history graphs not rendering sample data in the demo.

## 1.4.0

**Production Ingress — tokenless auth & durable config.**

- **Tokenless connection.** The add-on now relays the Home Assistant
  WebSocket using its own Supervisor credentials, so the browser no
  longer needs a hand-pasted long-lived access token under Ingress.
- **Durable configuration.** Settings and your uploaded `.glb` model are
  persisted server-side in the add-on's `/data` directory, surviving
  add-on updates and browser/kiosk resets. Previously everything lived
  only in the browser and was lost on a refresh or origin change.
- **Side panel.** The left rail now collapses to zero width when it has
  no cards, so the 3D scene fills the view; a floating Settings gear
  replaces it. The rail (and its resize handle) returns when you add a card.
- Runtime switched from nginx to a small Node server to power the relay
  and persistence; `nginx.conf` removed.

## 1.3.0

**BLE positioning fork with calibration.**

- Real-time BLE positioning of devices inside the 3D scene (Bermuda /
  Private BLE Device), with a 3-tap calibration wizard.
- k-NN fingerprint solver at the top of the solver chain for homes with
  walls / multipath.
- Anchor discovery and management, diagnostics overlay, stale-anchor
  warnings, and calibration export/import.
- Packaged as a Home Assistant add-on with Ingress + Companion App support.
