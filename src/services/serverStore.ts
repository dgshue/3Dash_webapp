/**
 * Durable, server-side persistence for the HA add-on.
 *
 * Stock 3Dash keeps everything in the browser (localStorage + IndexedDB). Under
 * the add-on that's fragile: a kiosk that clears storage, a different browser,
 * or a fresh origin all lose the config, so users re-enter it after every
 * update. This module mirrors the important state to the add-on's `/data`
 * directory (which HA preserves across add-on updates) via the relay server's
 * `/3dash/store` and `/3dash/model` endpoints.
 *
 * Policy: the server is the source of truth. On boot we hydrate localStorage /
 * IndexedDB from the server; if the server is empty (first run) we seed it from
 * whatever is already local. Thereafter every write to a tracked key is mirrored
 * back. Outside Ingress every function is a no-op, so standalone/hosted/demo
 * behaviour is unchanged.
 */

import { isIngress, ingressBasePath } from '../utils/embedMode';
import { getModel as dbGetModel, saveModel as dbSaveModel } from './storageApi';

/** localStorage keys we persist server-side. */
const TRACKED_KEYS = ['settings', 'config', '3dash.calibration'];

function storeUrl(): string {
  return `${ingressBasePath()}3dash/store`;
}

function modelUrl(): string {
  return `${ingressBasePath()}3dash/model`;
}

/** Pull config/settings/calibration + model from the server into local storage.
 *  Call once, before the app renders. */
export async function hydrateFromServer(): Promise<void> {
  if (!isIngress()) return;

  // 1. JSON blob (settings / config / calibration)
  try {
    const res = await fetch(storeUrl(), { cache: 'no-store' });
    if (res.ok) {
      const blob = (await res.json()) as Record<string, unknown>;
      let serverHadData = false;
      for (const key of TRACKED_KEYS) {
        const val = blob[key];
        if (val != null) {
          serverHadData = true;
          localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
        }
      }
      // First run: nothing on the server yet — seed it from existing local state.
      if (!serverHadData) await pushToServer();
    }
  } catch {
    // Offline or first boot — fall back to whatever is local.
  }

  // 2. Model blob — only fetch if IndexedDB doesn't already have one.
  try {
    const existing = await dbGetModel();
    if (!existing) {
      const res = await fetch(modelUrl(), { cache: 'no-store' });
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) await dbSaveModel(blob);
      }
    }
  } catch {
    // No model on the server yet — fine.
  }
}

/** Push the current tracked localStorage keys to the server. */
export async function pushToServer(): Promise<void> {
  if (!isIngress()) return;
  const payload: Record<string, string> = {};
  for (const key of TRACKED_KEYS) {
    const val = localStorage.getItem(key);
    if (val != null) payload[key] = val;
  }
  try {
    await fetch(storeUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Best-effort; localStorage still holds the live copy.
  }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced mirror of localStorage → server. */
function schedulePush(): void {
  if (!isIngress()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushToServer();
  }, 400);
}

/** Upload the 3D model blob to the server so it survives add-on updates. */
export async function pushModel(blob: Blob): Promise<void> {
  if (!isIngress()) return;
  try {
    await fetch(modelUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'model/gltf-binary' },
      body: blob,
    });
  } catch {
    // Best-effort.
  }
}

/** Tell the server to drop the stored model (called on reset). */
export async function deleteModelOnServer(): Promise<void> {
  if (!isIngress()) return;
  try {
    await fetch(modelUrl(), { method: 'DELETE' });
  } catch {
    /* ignore */
  }
}

let installed = false;

/** Wrap localStorage.setItem so writes to tracked keys mirror to the server.
 *  Call once, AFTER hydrateFromServer(), so hydration writes don't echo back. */
export function installStoreSync(): void {
  if (!isIngress() || installed || typeof window === 'undefined') return;
  installed = true;
  const original = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key: string, value: string) => {
    original(key, value);
    if (TRACKED_KEYS.includes(key)) schedulePush();
  };
}
