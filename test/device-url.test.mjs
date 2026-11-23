// Device origin normalization: a typed IP or host name becomes an absolute URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, normalizeBaseUrl } from '../dist/host/store.js';

test('normalizeBaseUrl: bare IP, host, port, scheme, trailing slash and path', () => {
  assert.equal(normalizeBaseUrl('192.168.1.100'), 'http://192.168.1.100');
  assert.equal(normalizeBaseUrl('  192.168.1.100  '), 'http://192.168.1.100');
  assert.equal(normalizeBaseUrl('192.168.1.100:8080'), 'http://192.168.1.100:8080');
  assert.equal(normalizeBaseUrl('kvm.lan'), 'http://kvm.lan');
  assert.equal(normalizeBaseUrl('kvm.lan/'), 'http://kvm.lan');
  assert.equal(normalizeBaseUrl('http://192.168.1.100'), 'http://192.168.1.100');
  assert.equal(normalizeBaseUrl('http://192.168.1.100/'), 'http://192.168.1.100');
  assert.equal(normalizeBaseUrl('https://kvm.lan/'), 'https://kvm.lan');
  // A reverse-proxy path prefix survives.
  assert.equal(normalizeBaseUrl('https://proxy.lan/linkr/'), 'https://proxy.lan/linkr');
  assert.equal(normalizeBaseUrl('proxy.lan/linkr'), 'http://proxy.lan/linkr');
  assert.equal(normalizeBaseUrl(''), '');
  assert.equal(normalizeBaseUrl('   '), '');
});

test('store: adding and updating a device stores the absolute origin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kvmflow-url-'));
  try {
    const store = new Store({ dataDir: dir });
    store.initSync();
    const added = await store.addDevice({ name: 'Lab', baseUrl: '192.168.1.100', token: 'tok' });
    assert.equal(added.baseUrl, 'http://192.168.1.100');
    assert.equal(store.getDevice(added.id).baseUrl, 'http://192.168.1.100');

    const updated = await store.updateDevice(added.id, { baseUrl: 'kvm.lan:8080/' });
    assert.equal(updated.baseUrl, 'http://kvm.lan:8080');
    // The normalized value is what lands on disk.
    const onDisk = JSON.parse(readFileSync(join(dir, 'devices.json'), 'utf8'));
    assert.equal(onDisk[0].baseUrl, 'http://kvm.lan:8080');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: a scheme-less origin already in devices.json is repaired on load', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kvmflow-url-legacy-'));
  try {
    const seed = new Store({ dataDir: dir });
    seed.initSync();
    writeFileSync(join(dir, 'devices.json'), JSON.stringify([
      { id: 'dev-1', name: 'Legacy', driver: 'linkr', baseUrl: '10.0.0.9:8000', token: 'tok', createdAt: 1, updatedAt: 1 },
    ], null, 2));
    const store = new Store({ dataDir: dir });
    store.initSync();
    assert.equal(store.getDevice('dev-1').baseUrl, 'http://10.0.0.9:8000');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
