'use strict';

/*
 * 3Dash add-on Ingress server.
 *
 * Replaces the old static-nginx add-on. It does three jobs:
 *
 *  1. Serves the built SPA (from /var/www/html) behind HA Ingress.
 *  2. Relays the Home Assistant WebSocket. The browser connects to
 *     `<ingress>/3dash-ws` with NO token; this server opens the real core
 *     socket at ws://supervisor/core/websocket and authenticates with the
 *     add-on's injected SUPERVISOR_TOKEN. The long-lived token is gone — the
 *     privileged token never leaves the add-on.
 *  3. Persists config/settings/calibration (and the .glb model) under /data,
 *     which Home Assistant preserves across add-on updates. The SPA hydrates
 *     from here on load and mirrors changes back, so config survives updates.
 *
 * Requires `homeassistant_api: true` in config.yaml so SUPERVISOR_TOKEN can
 * reach core.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 8099);
const DIST = process.env.DIST_DIR || '/var/www/html';
const DATA_DIR = process.env.DATA_DIR || '/data';
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const MODEL_FILE = path.join(DATA_DIR, 'model.glb');

const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN || '';
const CORE_WS = process.env.CORE_WS || 'ws://supervisor/core/websocket';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function log(...args) {
  console.log('[3dash]', ...args);
}

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    log('could not create data dir', DATA_DIR, e.message);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // Guard against pathological uploads (model is the biggest; 64 MB is plenty).
      if (size > 64 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ *
 * Static + REST                                                       *
 * ------------------------------------------------------------------ */

function stripIngress(req, pathname) {
  // HA passes the ingress prefix both in the path and in X-Ingress-Path.
  // Strip it so we can resolve against DIST / our API routes.
  const prefix = req.headers['x-ingress-path'];
  if (prefix && pathname.startsWith(prefix)) {
    return pathname.slice(prefix.length) || '/';
  }
  return pathname;
}

function serveStatic(req, res, rel) {
  let clean = decodeURIComponent(rel.split('?')[0]);
  if (clean === '/' || clean === '') clean = '/index.html';
  // Prevent path traversal.
  const safe = path
    .normalize(clean)
    .replace(/^(\.\.[/\\])+/, '')
    .replace(/^[/\\]+/, '');
  let filePath = path.join(DIST, safe);
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || stat.isDirectory()) {
      // SPA fallback — let the hash router handle unknown paths.
      filePath = path.join(DIST, 'index.html');
    }
    fs.readFile(filePath, (rErr, data) => {
      if (rErr) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
      if (/\/assets\//.test(filePath)) {
        headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      } else {
        headers['Cache-Control'] = 'no-cache';
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = stripIngress(req, url.pathname);

  try {
    // --- config / settings / calibration blob ---
    if (pathname === '/3dash/store') {
      if (req.method === 'GET') {
        fs.readFile(STORE_FILE, (err, data) => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(err ? '{}' : data);
        });
        return;
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        ensureDataDir();
        fs.writeFile(STORE_FILE, body, (err) => {
          if (err) {
            res.writeHead(500);
            res.end(String(err.message));
          } else {
            res.writeHead(204);
            res.end();
          }
        });
        return;
      }
    }

    // --- 3D model blob ---
    if (pathname === '/3dash/model') {
      if (req.method === 'GET') {
        fs.readFile(MODEL_FILE, (err, data) => {
          if (err) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
          res.end(data);
        });
        return;
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        ensureDataDir();
        fs.writeFile(MODEL_FILE, body, (err) => {
          if (err) {
            res.writeHead(500);
            res.end(String(err.message));
          } else {
            res.writeHead(204);
            res.end();
          }
        });
        return;
      }
      if (req.method === 'DELETE') {
        fs.unlink(MODEL_FILE, () => {
          res.writeHead(204);
          res.end();
        });
        return;
      }
    }

    // --- health check ---
    if (pathname === '/3dash/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, hasToken: !!SUPERVISOR_TOKEN }));
      return;
    }

    // --- static SPA ---
    serveStatic(req, res, pathname);
  } catch (e) {
    log('request error', e.message);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('server error');
    }
  }
});

/* ------------------------------------------------------------------ *
 * WebSocket relay: browser <-> this server <-> HA core                *
 * ------------------------------------------------------------------ */

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const rel = stripIngress(req, pathname);
  if (rel === '/3dash-ws') {
    wss.handleUpgrade(req, socket, head, (ws) => relay(ws));
  } else {
    socket.destroy();
  }
});

function relay(browser) {
  let core = null;
  let coreAuthed = false;
  const pending = [];

  // Emulate HA's handshake so the unmodified browser client is happy.
  browser.send(JSON.stringify({ type: 'auth_required', ha_version: 'ingress' }));

  function openCore() {
    core = new WebSocket(CORE_WS);

    core.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'auth_required') {
        core.send(JSON.stringify({ type: 'auth', access_token: SUPERVISOR_TOKEN }));
        return;
      }
      if (msg.type === 'auth_ok') {
        coreAuthed = true;
        safeSend(browser, JSON.stringify({ type: 'auth_ok', ha_version: msg.ha_version }));
        for (const m of pending) core.send(m);
        pending.length = 0;
        return;
      }
      if (msg.type === 'auth_invalid') {
        log('core rejected supervisor token:', msg.message);
        safeSend(
          browser,
          JSON.stringify({ type: 'auth_invalid', message: 'Add-on Supervisor auth failed' }),
        );
        return;
      }
      // Authenticated traffic — pass straight through.
      safeSend(browser, data.toString());
    });

    core.on('close', () => browser.close());
    core.on('error', (e) => {
      log('core socket error:', e.message);
      browser.close();
    });
  }

  browser.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    // The browser's auth message carries a placeholder token — ignore it and
    // authenticate upstream ourselves with the Supervisor token.
    if (msg.type === 'auth') {
      if (!core) openCore();
      return;
    }
    if (coreAuthed && core && core.readyState === WebSocket.OPEN) {
      core.send(data.toString());
    } else {
      pending.push(data.toString());
    }
  });

  browser.on('close', () => {
    if (core) core.close();
  });
  browser.on('error', () => {
    if (core) core.close();
  });
}

function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

ensureDataDir();
server.listen(PORT, () => {
  log(`listening on :${PORT}  (core=${CORE_WS}, token=${SUPERVISOR_TOKEN ? 'present' : 'MISSING'})`);
});
