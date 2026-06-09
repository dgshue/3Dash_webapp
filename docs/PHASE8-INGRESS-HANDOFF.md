# Phase 8 — Ingress relay, tokenless auth, durable config: handoff & test runbook

Branch: `feat/production-ingress` (local, **uncommitted** as of handoff)
Goal: get 3Dash production-ready by fixing three issues, then test end-to-end on the live HA instance (`ha.shuehome.net`).

---

## 1. What changed and why

Three problems were addressed:

1. **Empty left rail.** `SidePanel.tsx` rendered a fixed-width rail even when it had no cards, because its inline `width` ignored the `--panel-size: 0` collapse that `Dashboard.tsx` already set. Fixed by collapsing the panel to zero (`.side-panel--collapsed`) when there are no cards and it isn't being edited; the Settings gear floats into the corner instead (reusing the embed-mode pattern).

2. **Config lost on every update.** All config/settings live in `localStorage` and the model in `IndexedDB` — purely browser-side, nothing server-side, so a kiosk/origin/update wipe loses everything. Fixed by persisting to the add-on's `/data` (which HA preserves across add-on updates) via a new server endpoint, with the SPA hydrating from and mirroring to it.

3. **Long-lived token.** The browser authenticated to HA with a hand-pasted long-lived token. Fixed by relaying the HA WebSocket through the add-on, which authenticates upstream with its injected `SUPERVISOR_TOKEN`. The browser sends no token at all under Ingress.

Both (2) and (3) are solved by one new component: the add-on is now a small Node server instead of static nginx.

---

## 2. Files changed

**Add-on (`3dash-addon/`)**
- `server/server.js` — **new.** Node server: serves the SPA, relays `/3dash-ws` to `ws://supervisor/core/websocket` (auth-injecting; emulates HA's `auth_required`→`auth_ok` handshake to the browser, authenticates upstream with `SUPERVISOR_TOKEN`), and persists `/3dash/store` (JSON) + `/3dash/model` (GLB) to `/data`. Also `/3dash/health`.
- `server/package.json` — **new.** Single dep: `ws`.
- `config.yaml` — version → **1.4.0**; added `homeassistant_api: true`. (Ingress was already on from Phase 6.)
- `Dockerfile` — runtime switched from nginx to `nodejs npm` + the server; `REPO_REF` default now `feat/production-ingress`.
- `run.sh` — now `exec node /opt/3dash/server.js`.
- `nginx.conf` — to be removed (unused).

**Frontend (`src/`)**
- `utils/embedMode.ts` — added `isIngress()` and `ingressBasePath()`.
- `services/haWebSocket.ts` — `buildWsUrl()` returns the same-origin relay URL under Ingress; token unused there.
- `services/settingsStore.ts` — under Ingress, `getSettings()` returns a placeholder live connection (`url/port/token = ingress/0/ingress`) so the `url && token` guards at connection sites pass without a real token. Respects explicit demo mode.
- `services/serverStore.ts` — **new.** `hydrateFromServer()` (pull `/data` → localStorage + IndexedDB, seed server on first run), `installStoreSync()` (mirror tracked localStorage keys back, debounced), `pushModel()` / `deleteModelOnServer()`. All no-ops outside Ingress.
- `services/configApi.ts` — `uploadModel()` mirrors the GLB to the server; `resetConfig()` clears it server-side.
- `main.tsx` — awaits `hydrateFromServer()` before first render, then `installStoreSync()`.
- `components/SidePanel/SidePanel.tsx` + `SidePanel.css` — collapse logic + `.side-panel--collapsed` styles.

Tracked localStorage keys mirrored to `/data`: `settings`, `config`, `3dash.calibration`.

---

## 3. Verification already done (in sandbox)

- `tsc --noEmit` — **clean** across the whole project with all changes integrated.
- `node --check server/server.js` — **passes.**
- Full `vite build` was **not** run in the sandbox (npm registry was blocked there + platform-native rollup mismatch). The add-on's Docker builder does a fresh Linux `npm ci` and is the canonical build — that's the first thing the test below exercises.

> Note: a sandbox filesystem-cache quirk made bash see stale/truncated copies of edited files during development. That's sandbox-only; the files on disk are correct (verified via direct reads). It does not affect Claude Code on the real filesystem.

---

## 4. Prerequisites before testing

1. **Commit + push the branch** (from a machine with the correct working tree):
   ```bash
   cd F:\GitHub\3Dash_webapp
   git rm 3dash-addon/nginx.conf   # if still present
   git add -A
   git commit -m "feat: ingress relay (tokenless) + /data persistence + side-panel collapse"
   git push -u origin feat/production-ingress
   ```
2. **Make HA see the new add-on files.** HA reads the add-on (config.yaml/Dockerfile/server/) from the branch the add-on **repository** tracks (the repo `https://github.com/dgshue/3Dash_webapp` is already added in HA → Settings → Add-ons → Repositories). If that's `main`, either merge `feat/production-ingress` into `main` or point the add-on at this branch. The Dockerfile's `REPO_REF` controls which branch the **SPA** is built from (currently `feat/production-ingress`).
3. **Rotate the leaked token.** A long-lived token is committed at `RuView/dashboard/3dash-https-build/settings.json` (and zip backups). Revoke it in HA → Profile → Security; it's no longer needed once Ingress works.

---

## 5. End-to-end test runbook

### A. Build & start
- HA → Settings → Add-ons → 3Dash → **Rebuild** (forces a fresh image from the pushed branch), then **Start**.
- **Expect:** build succeeds; add-on starts and stays running (not in a restart loop).

### B. Add-on log (Log tab)
- **Expect:** `[3dash] listening on :8099 (core=ws://supervisor/core/websocket, token=present)`.
- `token=MISSING` ⇒ `homeassistant_api: true` didn't take effect — recheck config.yaml / reinstall.

### C. Tokenless connection via Ingress
- Open 3Dash from the HA sidebar (Ingress), in a **fresh/incognito** profile that has never held 3Dash localStorage.
- **Expect:** it connects and shows live entity/orb data **without** ever asking for or storing a token. Settings → Connection should not require a token.
- In add-on log, the relay should reach `auth_ok` upstream. If the browser shows `auth_invalid`, the Supervisor token was rejected by core (check `ws://supervisor/core/websocket` is valid on this HA/Supervisor version).

### D. Empty side panel
- With no SidePanel cards configured: **expect no left rail** — only a small floating Settings gear, bottom-left. The 3D scene fills the width. Add a card → the rail returns. Resize handle only appears when the rail is present.

### E. Durable config (the headline persistence fix)
- In 3Dash, change something that writes config (e.g. theme, or place an anchor) and/or upload a `.glb`.
- HA → 3Dash → **Restart** the add-on.
- Reopen 3Dash in a **fresh** browser profile (proves it's not browser localStorage).
- **Expect:** settings + model are still there (served from `/data`). Confirm `/data/store.json` (and `/data/model.glb` if a model was uploaded) exist via the add-on's filesystem / `ha addons` if accessible.

### F. Mobile / Companion app
- Open via the HA Companion app (iOS/Android). **Expect:** Ingress renders, bottom-sheet panel behaves, no cert prompt.

### G. API cross-check (optional, from the HA browser console)
- Confirm 3Dash's data sources resolve: query `device_tracker.*bermuda*`, `sensor.*_area`, `sensor.*_floor` via the WS API or `/api/states`. These feed the relay/positioning.

### Rollback
- If anything fails: HA → 3Dash → revert to the previous version (or rebuild from the prior branch/tag). No HA-core config is touched by this change; it's contained to the add-on.

---

## 6. Known follow-ups / watch-outs

- **Onboarding under Ingress.** A brand-new Ingress install with no saved config will still run the onboarding wizard's HA-token step, which is unnecessary under Ingress. The connection works regardless (placeholder), but the UX should auto-skip the HA step when `isIngress()`. Not yet implemented.
- **`ws://supervisor/core/websocket`.** Documented path for add-ons with `homeassistant_api: true`; the one thing only a live test confirms on this Supervisor version (test step C).
- **Relay edge cases to watch in logs:** core restart mid-session (browser should reconnect via the existing 5s reconnect), and large model PUTs (server caps body at 64 MB).
- **Upstream PR.** Once verified, this + the BLE tracker/trilateration work is worth PRing to `Kdcius/3Dash_webapp`.

---

## 7. Quick reference — relay auth flow

```
browser ──connect──▶ /3dash-ws (add-on)
add-on  ──"auth_required"──▶ browser
browser ──"auth"{token: "ingress"}──▶ add-on   (token ignored)
add-on  ──connect──▶ ws://supervisor/core/websocket
core    ──"auth_required"──▶ add-on
add-on  ──"auth"{access_token: SUPERVISOR_TOKEN}──▶ core
core    ──"auth_ok"──▶ add-on
add-on  ──"auth_ok"──▶ browser   then transparent 1:1 bridge
```
