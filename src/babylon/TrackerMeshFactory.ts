import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Animation,
  CubicEase,
  EasingFunction,
  type Mesh,
} from '@babylonjs/core';
import type { TrackerConfig, LightPosition } from '../types';

/**
 * Tracker = emissive sphere that represents a BLE-tracked device (phone, watch).
 * Position is driven by the HA sensor.*_area entity (snap-to-room) and visibility
 * is driven by the device_tracker.* entity (home / not_home).
 *
 * Mirrors the LightMeshFactory pattern. Glow comes from the scene's existing
 * GlowLayer + emissive material.
 */

export interface TrackerMeshEntry {
  sphere: Mesh;
  mat: StandardMaterial;
  config: TrackerConfig;
  currentAreaId?: string;
}

export type TrackerMeshMap = Record<string, TrackerMeshEntry>;

const ANIM_FRAMES = 30; // 500 ms @ 60 fps
const FPS = 60;

export function createTrackerMesh(scene: Scene, cfg: TrackerConfig): TrackerMeshEntry {
  const diameter = cfg.diameter ?? 0.3;
  const sphere = MeshBuilder.CreateSphere(
    `tracker_${cfg.entityId}`,
    { diameter, segments: 16 },
    scene,
  );
  sphere.position = new Vector3(cfg.position.x, cfg.position.y, cfg.position.z);
  sphere.metadata = { trackerEntityId: cfg.entityId };
  sphere.isPickable = false;
  sphere.applyFog = false;

  const mat = new StandardMaterial(`trackermat_${cfg.entityId}`, scene);
  mat.disableLighting = true;
  const emissive = Color3.FromHexString(cfg.color ?? '#4ade80');
  const glowScale = cfg.glow ?? 1;
  mat.emissiveColor = emissive.scale(glowScale);
  // Diffuse stays dark so the sphere reads as a pure glowing dot.
  mat.diffuseColor = new Color3(0, 0, 0);
  sphere.material = mat;

  return { sphere, mat, config: cfg };
}

export function animateTrackerTo(scene: Scene, entry: TrackerMeshEntry, to: LightPosition): void {
  const target = new Vector3(to.x, to.y, to.z);
  if (entry.sphere.position.equalsWithEpsilon(target, 0.001)) return;

  const ease = new CubicEase();
  ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
  const anim = new Animation(
    `tracker_move_${entry.config.entityId}`,
    'position',
    FPS,
    Animation.ANIMATIONTYPE_VECTOR3,
    Animation.ANIMATIONLOOPMODE_CONSTANT,
  );
  anim.setKeys([
    { frame: 0, value: entry.sphere.position.clone() },
    { frame: ANIM_FRAMES, value: target },
  ]);
  anim.setEasingFunction(ease);
  scene.beginDirectAnimation(entry.sphere, [anim], 0, ANIM_FRAMES, false);
}

/** Snap to a position immediately (used on initial state seed). */
export function setTrackerPosition(entry: TrackerMeshEntry, to: LightPosition): void {
  entry.sphere.position.set(to.x, to.y, to.z);
}

export function setTrackerVisible(entry: TrackerMeshEntry, visible: boolean): void {
  entry.sphere.setEnabled(visible);
}

export function removeTrackerMesh(map: TrackerMeshMap, entityId: string): void {
  const e = map[entityId];
  if (!e) return;
  e.sphere.dispose();
  e.mat.dispose();
  delete map[entityId];
}

/** Dispose every tracker mesh (used on scene rebuild). */
export function disposeAllTrackers(map: TrackerMeshMap): void {
  for (const id of Object.keys(map)) removeTrackerMesh(map, id);
}

/**
 * Normalize a Home Assistant area name or slug to a canonical key.
 *
 * HA's `sensor.<phone>_area` returns the human-readable area NAME (e.g.
 * "Dining Room", "Greyson's Room") while the area registry / area_id is
 * a slug (e.g. `dining_room`, `greysons_room`). We want both sides of the
 * lookup to agree, so apply this on both:
 *   - the key when writing to `cfg.areaPositions`
 *   - the value when reading the HA sensor state
 *
 * Returns "" for null / empty / unknown inputs — callers should treat that
 * as a miss and fall back to `cfg.position`.
 */
export function normalizeAreaKey(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .toLowerCase()
    // strip apostrophes (Greyson's → greysons) — include curly + straight
    .replace(/['‘’ʼ`]/g, '')
    // collapse any non-alphanumeric run into a single underscore
    .replace(/[^a-z0-9]+/g, '_')
    // trim leading/trailing underscores
    .replace(/^_+|_+$/g, '');
}

/** Resolve a tracker's target position from its current area_id (or fallback).
 *
 *  Tolerates both forms for backward compatibility:
 *    1. Exact match — handles manually-tuned configs that already used
 *       custom keys.
 *    2. Normalized match — handles the common case where HA returns
 *       a name like "Dining Room" but the config uses `dining_room`.
 */
export function targetForArea(cfg: TrackerConfig, areaId: string | undefined): LightPosition {
  if (!areaId) return cfg.position;
  // Exact match wins (back-compat with manually-tuned configs)
  if (cfg.areaPositions[areaId]) return cfg.areaPositions[areaId];
  // Try the normalized form of the incoming areaId
  const normIn = normalizeAreaKey(areaId);
  if (normIn && cfg.areaPositions[normIn]) return cfg.areaPositions[normIn];
  // Last resort: scan keys, normalizing each one (handles configs whose keys
  // were typed inconsistently — e.g. "Dining Room" stored verbatim).
  for (const k of Object.keys(cfg.areaPositions)) {
    if (normalizeAreaKey(k) === normIn) return cfg.areaPositions[k];
  }
  return cfg.position;
}
