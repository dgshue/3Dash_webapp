import type { Scene } from '@babylonjs/core';
import type { LightPosition } from '../types';

/**
 * Enter a one-shot click-to-place pick mode on a Babylon scene.
 *
 * The next pointer-down inside the canvas that hits the model surface
 * (i.e. anything that isn't flagged with `metadata.previewTarget`) will
 * invoke `callback(point)` and auto-exit. No clamping is applied — the
 * picked y is whatever the model says, so multi-floor scenes work
 * naturally (click upstairs floor → upstairs y, click main floor → main y).
 *
 * If the click misses the model, the callback is still called with the
 * camera-ray's intersection of the y=0 plane as a sensible fallback.
 *
 * Returns a `cancel()` function that exits pick mode without firing the
 * callback. Cancel is also called automatically after a successful pick.
 *
 * This helper exists for callers that don't already have their own
 * pointer-handling plumbing (ConfigEditor has its own placing-mode flow
 * and does not need this — it's primarily for ad-hoc forms or standalone
 * components.)
 */
export function enterPickMode(
  scene: Scene,
  callback: (point: LightPosition) => void,
): () => void {
  let cancelled = false;
  const prevPointerDown = scene.onPointerDown;
  const canvas = scene.getEngine().getRenderingCanvas();
  const prevCursor = canvas?.style.cursor;
  if (canvas) canvas.style.cursor = 'crosshair';

  const cleanup = () => {
    if (cancelled) return;
    cancelled = true;
    scene.onPointerDown = prevPointerDown;
    if (canvas) canvas.style.cursor = prevCursor ?? 'default';
  };

  scene.onPointerDown = (evt, _pickInfo) => {
    if (cancelled) return;
    // Re-pick excluding preview meshes so we hit the actual model.
    const pick = scene.pick(
      scene.pointerX,
      scene.pointerY,
      (m) => !m.metadata?.previewTarget,
    );
    let point: LightPosition;
    if (pick?.hit && pick.pickedPoint) {
      point = {
        x: parseFloat(pick.pickedPoint.x.toFixed(3)),
        y: parseFloat(pick.pickedPoint.y.toFixed(3)),
        z: parseFloat(pick.pickedPoint.z.toFixed(3)),
      };
    } else {
      // Fallback: cast camera ray to the y=0 plane.
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, null, scene.activeCamera);
      if (ray.direction.y !== 0) {
        const t = -ray.origin.y / ray.direction.y;
        const x = ray.origin.x + ray.direction.x * t;
        const z = ray.origin.z + ray.direction.z * t;
        point = {
          x: parseFloat(x.toFixed(3)),
          y: 0,
          z: parseFloat(z.toFixed(3)),
        };
      } else {
        point = { x: 0, y: 0, z: 0 };
      }
    }
    cleanup();
    callback(point);
    // Don't propagate to whatever previous handler was; we consumed this click.
    evt.preventDefault?.();
  };

  return cleanup;
}
