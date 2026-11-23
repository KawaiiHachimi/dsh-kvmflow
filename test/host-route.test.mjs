// Host-side regression tests for the plugin's HTTP route registration and its
// compatibility with the DSH 0.2.3 admission API (requestRejection removed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { apply } = await import('../dist/host/index.js');

/** Minimal Host context that records the registered route and tools. */
function fakeCtx(connection) {
  const routes = [];
  const tools = [];
  const effects = [];
  return {
    ctx: {
      connection,
      webServer: { register: route => { routes.push(route); return () => {}; } },
      tools: { register: definition => { tools.push(definition); return () => {}; } },
      effect: fn => { const dispose = fn(); effects.push(dispose); return dispose; },
      get: () => undefined,
    },
    routes,
    tools,
    effects,
  };
}

const silentLogger = () => {
  const original = console.error;
  console.error = () => {};
  return () => { console.error = original; };
};

/** Drive the registered route handler with a fake request/response pair. */
async function callRoute(route, { method = 'POST', path = '/kvmflow/rpc', body = { method: 'state', params: {} } } = {}, peer) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:52443' },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; },
  };
  const res = {
    status: 0,
    headers: undefined,
    payload: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(payload) { this.payload = payload ?? ''; },
  };
  await route.handler(req, res, peer);
  return res;
}

test('host route registers with required auth and works when requestRejection is gone (DSH 0.2.3)', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'kvmflow-host-'));
  const restore = silentLogger();
  try {
    const { ctx, routes } = fakeCtx({});
    apply(ctx, { dataDir });
    assert.equal(routes.length, 1, 'one HTTP route registered');
    const route = routes[0];
    assert.equal(route.kind, 'prefix');
    assert.equal(route.path, '/kvmflow');
    assert.equal(route.auth, 'required', 'declares central admission for DSH 0.2.3+');

    // An admitted request carries a Peer and must reach the RPC layer.
    const ok = await callRoute(route, {}, { principal: { kind: 'browser' } });
    assert.equal(ok.status, 200, `expected 200, got ${ok.status}: ${ok.payload.slice(0, 200)}`);
    const parsed = JSON.parse(ok.payload);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.dataDir, dataDir);

    // Without a Peer and without the legacy guard, the handler refuses.
    const denied = await callRoute(route);
    assert.equal(denied.status, 401);
  } finally {
    restore();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('host route still honours a legacy requestRejection when present (DSH <= 0.2.2)', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'kvmflow-host-legacy-'));
  const restore = silentLogger();
  try {
    const { ctx, routes } = fakeCtx({ requestRejection: () => 401 });
    apply(ctx, { dataDir });
    const rejected = await callRoute(routes[0], {}, undefined);
    assert.equal(rejected.status, 401);
    assert.equal(rejected.payload, 'unauthorized');

    const admitted = await callRoute(routes[0], {}, { principal: { kind: 'browser' } });
    // The legacy guard still runs first and refuses, exactly as before.
    assert.equal(admitted.status, 401);
  } finally {
    restore();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('host route rejects unknown paths and non-POST methods', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'kvmflow-host-404-'));
  const restore = silentLogger();
  try {
    const { ctx, routes } = fakeCtx({});
    apply(ctx, { dataDir });
    const route = routes[0];
    const wrongPath = await callRoute(route, { path: '/kvmflow/other' }, { principal: { kind: 'browser' } });
    assert.equal(wrongPath.status, 404);
    const wrongMethod = await callRoute(route, { method: 'GET' }, { principal: { kind: 'browser' } });
    assert.equal(wrongMethod.status, 404);
  } finally {
    restore();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
