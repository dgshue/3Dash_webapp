# Tracker Entity — Implementation Plan

A "Tracker" is a moving emissive sphere in the Babylon scene that represents a Bermuda BLE-tracked device (phone, watch). It mirrors the `Light` entity pattern. Movement is **snap-to-room** v1: each tracker has an `areaPositions` map; when the HA `sensor.<tracker>_area` state changes, the sphere animates (500 ms ease) to the new position.

---

## 1. Type system extensions

**File:** `src/types/index.ts`

Current `LightConfig` is at **lines 38-61**. `AppConfig` is at **lines 145-159**. `LightPosition` at lines 8-12.

ADD after the `LightConfig` block (around line 62), before `LightGroup`:

```ts
export interface TrackerConfig {
  /** HA device_tracker.* entity (Bermuda BLE). Primary identity. */
  entityId: string;
  /** Optional HA sensor.*_area entity that reports current area_id. */
  areaEntityId?: string;
  label: string;
  /** Sphere diameter (default 0.3). */
  diameter?: number;
  /** Emissive color (hex, default "#4ade80"). */
  color?: string;
  /** Glow intensity multiplier (default 1). */
  glow?: number;
  /** Fallback world position when no area match (e.g. away from home). */
  position: LightPosition;
  /** area_id -> world coordinate. Sphere snaps here when areaEntityId state == area_id. */
  areaPositions: Record<string, LightPosition>;
  /** Hide sphere when device_tracker state == 'not_home' (default true). */
  hideWhenAway?: boolean;
}
```

MODIFY `AppConfig` (line 145) and `FullConfig` (line 167) — add `trackers?: TrackerConfig[];` next to `tubes?`.

---

## 2. Storage / serialization

**File:** `src/services/configApi.ts`

- `DEFAULT_CONFIG` (line 9-13): no change required (trackers defaults to undefined).
- `updateConfig` (line 44-64): MODIFY signature to accept `trackers?: TrackerConfig[]`. The function uses `Object.assign(...)` / spread, so adding the key to the type union is the only change.
- `exportBackup`/`importBackup`: nothing extra — they serialize the whole config object as JSON.

Persistence is `localStorage` under key `"config"` (line 7). No IndexedDB involvement for trackers.

---

## 3. Babylon scene rendering

**Reference file:** `src/babylon/LightMeshFactory.ts` (especially `createLightMesh` lines 58-217 and `removeLightMesh` lines 307-321).

**ADD new file:** `src/babylon/TrackerMeshFactory.ts`. Pattern:

```ts
import { Scene, MeshBuilder, StandardMaterial, Color3, Vector3,
  Animation, CubicEase, EasingFunction, type Mesh } from '@babylonjs/core';
import type { TrackerConfig, LightPosition } from '../types';

export interface TrackerMeshEntry {
  sphere: Mesh;
  mat: StandardMaterial;
  config: TrackerConfig;
  currentAreaId?: string;
}
export type TrackerMeshMap = Record<string, TrackerMeshEntry>;

export function createTrackerMesh(scene: Scene, cfg: TrackerConfig): TrackerMeshEntry {
  const sphere = MeshBuilder.CreateSphere(`tracker_${cfg.entityId}`,
    { diameter: cfg.diameter ?? 0.3 }, scene);
  sphere.position = new Vector3(cfg.position.x, cfg.position.y, cfg.position.z);
  sphere.metadata = { trackerEntityId: cfg.entityId };
  sphere.isPickable = false;
  sphere.applyFog = false;
  const mat = new StandardMaterial(`trackermat_${cfg.entityId}`, scene);
  mat.disableLighting = true;
  mat.emissiveColor = Color3.FromHexString(cfg.color ?? '#4ade80');
  sphere.material = mat;
  return { sphere, mat, config: cfg };
}

export function animateTrackerTo(scene: Scene, entry: TrackerMeshEntry, to: LightPosition) {
  const fps = 60, frames = 30; // 500ms
  const ease = new CubicEase(); ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
  const anim = new Animation('tracker_move', 'position', fps,
    Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
  anim.setKeys([{ frame: 0, value: entry.sphere.position.clone() },
                { frame: frames, value: new Vector3(to.x, to.y, to.z) }]);
  anim.setEasingFunction(ease);
  scene.beginDirectAnimation(entry.sphere, [anim], 0, frames, false);
}

export function removeTrackerMesh(map: TrackerMeshMap, entityId: string): void {
  const e = map[entityId]; if (!e) return;
  e.sphere.dispose(); e.mat.dispose(); delete map[entityId];
}
```

Glow: the Dashboard already creates a `GlowLayer` (`ctx.glowLayer`, used by tubes — `Dashboard.tsx:816`). Emissive materials automatically participate.

The Babylon animation pattern to copy lives at `Dashboard.tsx:1335-1378` (CubicEase + `scene.beginAnimation`).

---

## 4. HA WebSocket state subscriptions

**File:** `src/services/haWebSocket.ts` — already broadcasts ALL `state_changed` events via `onStateChanged` at **line 86**. No change needed.

**Routing in `src/pages/Dashboard/Dashboard.tsx`:**

- `onStateChanged` callback lives at **lines 1029-1066**. It dispatches based on entityId.
- `onInitialStates` at **lines 1067-1103** seeds initial values for everything.

ADD a tracker map ref next to `meshMapRef` (Dashboard.tsx:62):
```ts
const trackerMapRef = useRef<TrackerMeshMap>({});
const trackerAreaToEntityRef = useRef<Record<string,string>>({}); // areaEntityId -> trackerEntityId
```

In the `onStateChanged` body (after line 1031), add:
```ts
// Tracker: device_tracker.* state change (home/away)
if (trackerMapRef.current[entityId]) {
  const entry = trackerMapRef.current[entityId];
  const away = state.state === 'not_home' || state.state === 'unavailable';
  entry.sphere.setEnabled(!(away && (entry.config.hideWhenAway ?? true)));
}
// Tracker area sensor changed → move sphere
const tEntityId = trackerAreaToEntityRef.current[entityId];
if (tEntityId) {
  const entry = trackerMapRef.current[tEntityId];
  if (entry) {
    const areaId = state.state;
    const target = entry.config.areaPositions[areaId] ?? entry.config.position;
    entry.currentAreaId = areaId;
    animateTrackerTo(sceneCtxRef.current!.scene, entry, target);
  }
}
```

Mirror the same logic inside `onInitialStates` (around line 1079 forEach) so trackers start at the correct position.

Build the lookup right above the `callbacks` block (~line 1019, where `modeSensorToLight` is built):
```ts
for (const t of (config.trackers ?? [])) {
  if (t.areaEntityId) trackerAreaToEntityRef.current[t.areaEntityId] = t.entityId;
}
```

Create tracker meshes during scene init alongside lights — at `Dashboard.tsx:784-793` (`config.lights.forEach`). Add directly below:
```ts
(config.trackers ?? []).forEach((t) => {
  trackerMapRef.current[t.entityId] = createTrackerMesh(ctx.scene, t);
});
```

Also dispose them in the cleanup at `Dashboard.tsx:988-993` (and the rebuild block at line 1279).

---

## 5. UI for config editor

**Reference:** `src/pages/ConfigEditor/ConfigEditor.tsx`. Tabs at **lines 1776-1805**. Lists at **lines 1807-1847**. Footer at **lines 1849-1873**. Pattern for tubes is the closest mirror (CRUD without group hierarchy).

MODIFY `editorMode` union (line 89):
```ts
useState<'lights'|'displays'|'walls'|'tubes'|'trackers'>('lights');
```

ADD state next to tubes (lines 142-148):
```ts
const [trackers, setTrackers] = useState<TrackerConfig[]>([]);
const [trackerEditIdx, setTrackerEditIdx] = useState<number|null>(null);
const trackersRef = useRef(trackers); trackersRef.current = trackers;
```

Load (~line 481): `setTrackers(config.trackers || []);`

ADD CRUD handlers mirroring `handleAddTube/handleDeleteTube/handleDuplicateTube/handleSaveTube` — each calls `await updateConfig({ trackers: updated })`.

ADD tab button + list + add-button in the three switch blocks at 1798/1838/1862.

**ADD new file `src/components/TrackerList.tsx`** (mirror `TubeList.tsx`):
```ts
interface Props {
  trackers: TrackerConfig[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  onDelete: (idx: number) => void;
  onDuplicate: (idx: number) => void;
  onAutoDiscover: () => void; // calls HA, appends device_tracker.* with source_type=bluetooth_le
}
```

**ADD new file `src/components/TrackerForm.tsx`** — fields: entityId (EntityPicker filtered to `device_tracker.*`), areaEntityId (EntityPicker filtered to `sensor.*_area`), label, diameter, color (ColorWheel), glow, position {x,y,z}, areaPositions map editor with rows `[area_id] x y z [delete]` and a "Seed defaults" button that adds rows for `living_room`, `kitchen`, `dining_room`, `laundry_room`.

**Auto-discover Bermuda trackers** (`onAutoDiscover` impl): call `getActiveHAConnection()?.request({ type: 'get_states' })` (returns `HAState[]`), filter where `entity_id.startsWith('device_tracker.')` AND `attributes.source_type === 'bluetooth_le'`. For each, generate a `TrackerConfig` with `areaEntityId` guessed as `sensor.${entity_id.replace('device_tracker.','')}_area`, `position` = scene center, `areaPositions` seeded with the four default rooms at fallback positions. Skip duplicates. Then `setTrackers([...trackers, ...newOnes]); updateConfig({ trackers: ... });`.

---

## 6. Position computation

V1 = snap-to-room with 500 ms ease animation. Code shown in section 3 (`animateTrackerTo`). The animation pattern follows the same Babylon `Animation` + `CubicEase` + `EasingFunction.EASINGMODE_EASEINOUT` recipe used by the camera home-view animation at `Dashboard.tsx:1335-1378`.

Default areas to seed (HA): `living_room`, `kitchen`, `dining_room`, `laundry_room`. Seed values can be the same coords as some existing light positions — the user will tune in the TrackerForm.

---

## 7. File change order (dependency order)

| # | File | Action |
|---|------|--------|
| 1 | `src/types/index.ts` | MODIFY — add `TrackerConfig`, extend `AppConfig` + `FullConfig` |
| 2 | `src/services/configApi.ts` | MODIFY — add `trackers?` to `updateConfig` signature |
| 3 | `src/babylon/TrackerMeshFactory.ts` | ADD — new file |
| 4 | `src/babylon/LightMeshFactory.ts` | READ ONLY (reference pattern) |
| 5 | `src/components/TrackerList.tsx` | ADD — mirror `TubeList.tsx` |
| 6 | `src/components/TrackerForm.tsx` | ADD — mirror `LightForm.tsx` (simpler) |
| 7 | `src/components/EntityPicker.tsx` | READ ONLY (reuse with prefix filter) |
| 8 | `src/pages/Dashboard/Dashboard.tsx` | MODIFY — create meshes (~L784), route state (~L1029, L1079), dispose (~L988, L1279), add `trackerMapRef` / lookup ref |
| 9 | `src/pages/ConfigEditor/ConfigEditor.tsx` | MODIFY — add tab, list, form panel, CRUD handlers, auto-discover button |

---

## 8. Caveats / gotchas

- **`SimulationModeContext`** (`src/contexts/SimulationModeContext.tsx`): `updateConfig` in `configApi.ts:54-60` skips `localStorage` when `isSimulationActive()` returns true and instead mutates `simulationConfigOverride`. Make sure tracker writes ride the same path (they will automatically since `updateConfig` is the single funnel).
- **DemoHAConnection** (`src/services/demoHAConnection.ts`): only fires events for entities you tell it about. In `Dashboard.tsx:1110-1127` add tracker `entityId`s and `areaEntityId`s to `sensorIds` so demo mode still moves spheres. Without this, trackers will be invisible in demo/simulation.
- **Two scene-init paths**: meshes get built at `Dashboard.tsx:784` AND rebuilt at `Dashboard.tsx:1279-1297`. You must add the tracker `forEach` in BOTH locations.
- **`onInitialStates` race**: device_tracker state arrives in `onInitialStates`, but `trackerMapRef.current[entityId]` may not yet match — initial states are keyed by `device_tracker.*` (matches trackerMap) AND by `sensor.*_area` (matches `trackerAreaToEntityRef`). Handle both paths inside the initial-states forEach.
- **Glow layer**: Babylon's `GlowLayer` is already created (`ctx.glowLayer`, see tube creation at `Dashboard.tsx:816`). Emissive `StandardMaterial` participates automatically — no need to call `glowLayer.addIncludedOnlyMesh`.
- **`structuredClone` in `getConfig` (line 32)**: confirms config is deeply copied for simulation. `areaPositions` plain-object will clone fine.
- **localStorage key `"config"`** (line 7): single blob. No migration needed since `trackers` is optional.
- **`ConfigEditor` has parallel state + ref pairs** (`lightsRef`/`lights`, etc.) — the ref is needed because Babylon scene callbacks fire outside React render. Follow the same pattern (`trackers` + `trackersRef`) or callbacks will close over stale data.
- **EntityPicker entity list** comes from `entityCache` set inside `onInitialStates` (Dashboard.tsx:1067-1072). It only carries `entity_id` + `friendly_name` — it does NOT include `attributes.source_type`. Auto-discover therefore must call `getActiveHAConnection().request({ type: 'get_states' })` directly (NOT use entityCache) to filter by `source_type === 'bluetooth_le'`.
- **`hideWhenAway`**: a tracker's `device_tracker.*` state of `not_home` should hide the sphere; `home` shows it. Easy to forget on init.
