import type { HAState } from '../types';
import { isIngress, ingressBasePath } from '../utils/embedMode';

export type HAConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'auth_error';

/** Best-guess reason for the most recent status transition. Populated when
 *  status moves to error / auth_error / disconnected so the UI can surface
 *  it without needing devtools. Cleared on successful reconnect. */
export interface HAConnectionError {
  status: HAConnectionStatus;
  message: string;
  /** ms epoch when the error happened. */
  at: number;
}

export interface HACallbacks {
  onStateChanged?: (entityId: string, state: HAState) => void;
  onInitialStates?: (states: HAState[]) => void;
  onStatusChanged?: (status: HAConnectionStatus, error?: HAConnectionError) => void;
}

/** Minimal interface shared by HAConnection and DemoHAConnection. */
export interface HALike {
  callService(domain: string, service: string, entityId: string, data?: Record<string, unknown>): Promise<void>;
  request(msg: Record<string, unknown>): Promise<unknown>;
  readonly isConnected: boolean;
  dispose(): void;
}

/** Module-level reference to the active HA connection (set by Dashboard). */
let activeConnection: HALike | null = null;
export function setActiveHAConnection(conn: HALike | null) { activeConnection = conn; }
export function getActiveHAConnection(): HALike | null { return activeConnection; }

export interface HAConnectOptions {
  url: string;
  port: number;
  token: string;
}

/** Build a WebSocket URL, using wss:// when the page is served over HTTPS.
 *
 * Under HA Ingress the host/port are ignored: we connect same-origin to the
 * add-on's relay (`<ingress>/3dash-ws`), which authenticates upstream with the
 * Supervisor token. The caller's token is unused in that path. */
export function buildWsUrl(url: string, port: number): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  if (isIngress()) {
    return `${protocol}://${window.location.host}${ingressBasePath()}3dash-ws`;
  }
  return `${protocol}://${url}:${port}/api/websocket`;
}

export class HAConnection {
  private ws: WebSocket | null = null;
  private msgId = 1;
  private callbacks: HACallbacks;
  private options: HAConnectOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private pendingResults = new Map<number, { resolve: (value?: unknown) => void; reject: (err: Error) => void }>();

  constructor(options: HAConnectOptions, callbacks: HACallbacks) {
    this.options = options;
    this.callbacks = callbacks;
  }

  connect(): void {
    if (this.disposed) return;
    this.callbacks.onStatusChanged?.('connecting');

    const { url, port } = this.options;
    const wsUrl = buildWsUrl(url, port);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      // Wait for auth_required from HA
    };

    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);

      if (msg.type === 'auth_required') {
        this.send({ type: 'auth', access_token: this.options.token });
        return;
      }

      if (msg.type === 'auth_ok') {
        this.callbacks.onStatusChanged?.('connected');
        // Subscribe to state changes
        this.send({ id: this.msgId++, type: 'subscribe_events', event_type: 'state_changed' });
        // Fetch initial states
        this.send({ id: this.msgId++, type: 'get_states' });
        return;
      }

      if (msg.type === 'auth_invalid') {
        this.callbacks.onStatusChanged?.('auth_error', {
          status: 'auth_error',
          message: msg.message ?? 'Invalid access token. Generate a new long-lived token in HA → Profile → Security.',
          at: Date.now(),
        });
        return;
      }

      if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
        const { entity_id, new_state } = msg.event.data;
        this.callbacks.onStateChanged?.(entity_id, new_state);
        return;
      }

      if (msg.type === 'result') {
        const pending = this.pendingResults.get(msg.id);
        if (pending) {
          this.pendingResults.delete(msg.id);
          msg.success ? pending.resolve(msg.result) : pending.reject(new Error(msg.error?.message ?? 'Service call failed'));
        } else if (Array.isArray(msg.result)) {
          this.callbacks.onInitialStates?.(msg.result);
        }
        return;
      }
    };

    this.ws.onerror = () => {
      // The WebSocket Web API doesn't expose the underlying reason in the
      // error event (security). The common failure modes from an HTTPS page
      // are wss:// to a plain-HTTP HA, an invalid cert, or unreachable host.
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      const guess = isHttps
        ? `WebSocket failed to ${wsUrl}. If HA is plain HTTP, an HTTPS page can't connect — use the HTTPS HA URL (e.g. via a reverse proxy or Nabu Casa) instead.`
        : `WebSocket failed to ${wsUrl}. Check the host / port and that HA is reachable.`;
      this.callbacks.onStatusChanged?.('error', {
        status: 'error',
        message: guess,
        at: Date.now(),
      });
    };

    this.ws.onclose = (ev) => {
      for (const p of this.pendingResults.values()) p.reject(new Error('Connection closed'));
      this.pendingResults.clear();
      if (this.disposed) return;
      // Code 1006 = abnormal closure (no close frame) — often the mixed-content
      // / TLS handshake failure case. Surface a slightly more specific hint.
      const message =
        ev.code === 1006
          ? `Connection closed without a close frame (code 1006). Common causes: TLS handshake failure, mixed-content block, or HA process restart. Reconnecting in 5s…`
          : `Connection closed (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}). Reconnecting in 5s…`;
      this.callbacks.onStatusChanged?.('disconnected', {
        status: 'disconnected',
        message,
        at: Date.now(),
      });
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    };
  }

  callService(domain: string, service: string, entityId: string, data?: Record<string, unknown>): Promise<void> {
    return this.request({
      type: 'call_service',
      domain,
      service,
      target: { entity_id: entityId },
      ...(data ? { service_data: data } : {}),
    }) as Promise<void>;
  }

  /** Send an arbitrary WS message and return the result. */
  request(msg: Record<string, unknown>): Promise<unknown> {
    const id = this.msgId++;
    return new Promise((resolve, reject) => {
      this.pendingResults.set(id, { resolve, reject });
      this.send({ ...msg, id });
      setTimeout(() => {
        if (this.pendingResults.delete(id)) reject(new Error('Timeout'));
      }, 15000);
    });
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
