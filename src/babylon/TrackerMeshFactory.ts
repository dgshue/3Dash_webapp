import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  AbstractMesh,
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
  /** Phase 7: translucent confidence sphere — sized by Kalman position
   *  variance. Hidden by default; toggled on via setTrackerConfidence. */
  confidenceSphere?: Mesh;
  confidenceMat?: StandardMaterial;
  /** Optional floating text label parented to the sphere. Always faces the
   *  camera. Toggled via appearance.showTrackerLabels. Cached text avoids
   *  pointless DynamicTexture redraws when nothing changes. */
  label?: Mesh;
  labelMat?: StandardMaterial;
  labelTex?: DynamicTexture;
  labelText?: string;
}

export type TrackerMeshMap = Record<string, TrackerMeshEntry>;

const ANIM_FRAMES = 30; // 500 ms @ 60 fps
const FPS = 60;

export function createTrackerMesh(
  scene: Scene,
  cfg: TrackerConfig,
  showLabel = false,
): TrackerMeshEntry {
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

  const entry: TrackerMeshEntry = { sphere, mat, config: cfg };
  if (showLabel) {
    ensureLabel(scene, entry);
    setTrackerLabel(scene, entry, defaultLabelText(cfg));
  }
  return entry;
}

/* ─── Tracker label (Phase 8) ─────────────────────────────────────────────
 *  A camera-facing plane parented to the sphere. Same pattern as the
 *  confidenceSphere above: lazily created, disposed via removeTrackerMesh.
 *  Texture redraws are debounced by labelText cache to keep the DynamicTexture
 *  off the per-frame path.
 */

const LABEL_TEX_W = 256;
const LABEL_TEX_H = 64;
const LABEL_PLANE_W = 0.6;
const LABEL_PLANE_H = 0.15;
const LABEL_Y_OFFSET = 0.3;
const LABEL_FONT = 'bold 36px "DM Mono", monospace';

/** Build the label plane / texture / material if not already present. */
function ensureLabel(scene: Scene, entry: TrackerMeshEntry): void {
  if (entry.label) return;
  const id = entry.config.entityId;
  const plane = MeshBuilder.CreatePlane(
    `tracker_label_${id}`,
    { width: LABEL_PLANE_W, height: LABEL_PLANE_H },
    scene,
  );
  plane.parent = entry.sphere;
  plane.position = new Vector3(0, LABEL_Y_OFFSET, 0);
  plane.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  plane.applyFog = false;
  plane.renderingGroupId = 1; // draw over geometry

  const texture = new DynamicTexture(
    `tracker_labeltex_${id}`,
    { width: LABEL_TEX_W, height: LABEL_TEX_H },
    scene,
    true,
  );
  texture.hasAlpha = true;

  const material = new StandardMaterial(`tracker_labelmat_${id}`, scene);
  material.disableLighting = true;
  material.emissiveColor = new Color3(1, 1, 1);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.opacityTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.backFaceCulling = false;
  plane.material = material;

  entry.label = plane;
  entry.labelTex = texture;
  entry.labelMat = material;
}

/** Pick the display text: the tracker's label, falling back to the entity
 *  ID's slug, then the raw entity ID. */
function defaultLabelText(cfg: TrackerConfig): string {
  return cfg.label || cfg.entityId.split('.')[1] || cfg.entityId;
}

/** Paint `text` onto the label texture (creates the plane lazily if missing).
 *  No-op if the text hasn't changed since the last call. */
export function setTrackerLabel(scene: Scene, entry: TrackerMeshEntry, text: string): void {
  ensureLabel(scene, entry);
  if (entry.labelText === text) return;
  entry.labelText = text;
  const tex = entry.labelTex;
  if (!tex) return;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const w = LABEL_TEX_W;
  const h = LABEL_TEX_H;
  ctx.clearRect(0, 0, w, h);

  // Rounded background panel (rgba black @ 60%, 4px corner)
  const r = 4;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  // Text — clip to the texture bounds so long labels just get cut, no scroll.
  ctx.save();
  ctx.beginPath();
  ctx.rect(6, 0, w - 12, h);
  ctx.clip();
  ctx.font = LABEL_FONT;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  ctx.restore();

  tex.update();
}

/** Toggle label visibility. Safe to call when no label exists (no-op). */
export function setTrackerLabelVisible(entry: TrackerMeshEntry, visible: boolean): void {
  if (visible && !entry.label) {
    const scene = entry.sphere.getScene();
    ensureLabel(scene, entry);
    setTrackerLabel(scene, entry, defaultLabelText(entry.config));
  }
  entry.label?.setEnabled(visible);
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

/**
 * Phase 7: Show a translucent sphere around the tracker sized by the Kalman
 * position-uncertainty (1-σ in meters, derived from sqrt(varianceTrace / 3)
 * for an even-axis approximation). Pass radius <= 0 to hide.
 *
 * Not a full covariance ellipsoid (Phase 7 left that as a stretch goal).
 * A symmetric sphere is plenty for a visual cue — "small sphere = confident,
 * big sphere = unsure" reads instantly without 9 scalars of math.
 */
export function setTrackerConfidence(scene: Scene, entry: TrackerMeshEntry, radius: number): void {
  if (radius <= 0) {
    if (entry.confidenceSphere) { entry.confidenceSphere.dispose(); entry.confidenceSphere = undefined; }
    if (entry.confidenceMat) { entry.confidenceMat.dispose(); entry.confidenceMat = undefined; }
    return;
  }
  if (!entry.confidenceSphere) {
    const s = MeshBuilder.CreateSphere(
      `tracker_conf_${entry.config.entityId}`,
      { diameter: 1, segments: 20 },
      scene,
    );
    s.isPickable = false;
    s.applyFog = false;
    s.parent = entry.sphere;  // follows the tracker automatically
    const m = new StandardMaterial(`tracker_confmat_${entry.config.entityId}`, scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.FromHexString(entry.config.color ?? '#4ade80');
    m.diffuseColor = new Color3(0, 0, 0);
    m.alpha = 0.12;
    s.material = m;
    entry.confidenceSphere = s;
    entry.confidenceMat = m;
  }
  // Diameter, not radius, since we built the sphere with diameter: 1.
  entry.confidenceSphere.scaling.setAll(radius * 2);
}

export function removeTrackerMesh(map: TrackerMeshMap, entityId: string): void {
  const e = map[entityId];
  if (!e) return;
  e.sphere.dispose();
  e.mat.dispose();
  e.confidenceSphere?.dispose();
  e.confidenceMat?.dispose();
  e.label?.dispose();
  e.labelTex?.dispose();
  e.labelMat?.dispose();
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
