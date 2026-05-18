import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  type Mesh,
} from '@babylonjs/core';
import type { AnchorConfig } from '../types';

/**
 * Anchor = small static pin marker representing an ESPHome BLE scanner / anchor.
 * Visually distinct from tracker spheres: a low cone (pin) shape with a
 * slim cyan color by default. Optional translucent "distance sphere" can be
 * shown for debugging (Phase C will toggle this from the form).
 *
 * Mirrors the LightMeshFactory / TrackerMeshFactory exports pattern:
 *   createAnchorMesh / removeAnchorMesh / disposeAllAnchors / setAnchorPosition
 */

export interface AnchorMeshEntry {
  pin: Mesh;
  mat: StandardMaterial;
  /** Optional debug sphere visualizing measured distance. Disabled by default. */
  debugSphere?: Mesh;
  debugMat?: StandardMaterial;
  config: AnchorConfig;
}

export type AnchorMeshMap = Record<string, AnchorMeshEntry>;

const ANCHOR_COLOR = '#22d3ee';   // cyan — distinct from tracker green
const ANCHOR_HEIGHT = 0.4;
const ANCHOR_DIAMETER = 0.18;

export function createAnchorMesh(scene: Scene, cfg: AnchorConfig): AnchorMeshEntry {
  // Inverted cone (point down) so it reads as a "pin" stuck into the floor.
  const pin = MeshBuilder.CreateCylinder(
    `anchor_${cfg.deviceId}`,
    {
      diameterTop: ANCHOR_DIAMETER,
      diameterBottom: 0.02,
      height: ANCHOR_HEIGHT,
      tessellation: 16,
    },
    scene,
  );
  pin.position = new Vector3(cfg.position.x, cfg.position.y, cfg.position.z);
  pin.metadata = { anchorDeviceId: cfg.deviceId };
  pin.isPickable = false;
  pin.applyFog = false;

  const mat = new StandardMaterial(`anchormat_${cfg.deviceId}`, scene);
  mat.disableLighting = true;
  const emissive = Color3.FromHexString(ANCHOR_COLOR);
  mat.emissiveColor = emissive;
  mat.diffuseColor = new Color3(0, 0, 0);
  pin.material = mat;

  return { pin, mat, config: cfg };
}

export function setAnchorPosition(entry: AnchorMeshEntry, x: number, y: number, z: number): void {
  entry.pin.position.set(x, y, z);
  if (entry.debugSphere) entry.debugSphere.position.set(x, y, z);
}

export function setAnchorVisible(entry: AnchorMeshEntry, visible: boolean): void {
  entry.pin.setEnabled(visible);
  if (entry.debugSphere) entry.debugSphere.setEnabled(visible);
}

/** Show a translucent sphere of `radius` meters centered on the anchor.
 *  Pass radius <= 0 to hide. */
export function setAnchorDebugRadius(scene: Scene, entry: AnchorMeshEntry, radius: number): void {
  if (radius <= 0) {
    if (entry.debugSphere) { entry.debugSphere.dispose(); entry.debugSphere = undefined; }
    if (entry.debugMat) { entry.debugMat.dispose(); entry.debugMat = undefined; }
    return;
  }
  if (!entry.debugSphere) {
    const s = MeshBuilder.CreateSphere(
      `anchor_dbg_${entry.config.deviceId}`,
      { diameter: 1, segments: 16 },
      scene,
    );
    s.isPickable = false;
    s.applyFog = false;
    const m = new StandardMaterial(`anchor_dbgmat_${entry.config.deviceId}`, scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.FromHexString(ANCHOR_COLOR);
    m.alpha = 0.08;
    m.diffuseColor = new Color3(0, 0, 0);
    s.material = m;
    entry.debugSphere = s;
    entry.debugMat = m;
  }
  entry.debugSphere.scaling.setAll(radius * 2);
  entry.debugSphere.position.copyFrom(entry.pin.position);
}

export function removeAnchorMesh(map: AnchorMeshMap, deviceId: string): void {
  const e = map[deviceId];
  if (!e) return;
  e.pin.dispose();
  e.mat.dispose();
  e.debugSphere?.dispose();
  e.debugMat?.dispose();
  delete map[deviceId];
}

export function disposeAllAnchors(map: AnchorMeshMap): void {
  for (const id of Object.keys(map)) removeAnchorMesh(map, id);
}
