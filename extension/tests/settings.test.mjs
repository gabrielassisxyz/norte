import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { serverOrigin, originPattern, configureServer, configuredOrigin } from '../src/settings.js';
import { buildExtension } from '../build.mjs';

function settingsAPI(granted = true) {
  const requests = [], writes = [];
  return { requests, writes, permissions: {
    request: async (request) => { requests.push(request); return granted; }, contains: async () => granted,
  }, storage: { local: { get: async () => ({}), set: async (value) => writes.push(value) } } };
}

test('manifest and exact optional origin grant', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
  assert.equal(originPattern('http://host:8080/'), 'http://host:8080/*');
  const api = settingsAPI();
  await configureServer('http://host:8080/', api, async (url) => {
    assert.equal(url, 'http://host:8080/api/health');
    assert.equal(api.writes.length, 0);
    return { status: 200 };
  });
  assert.deepEqual(api.requests, [{ origins: ['http://host:8080/*'] }]);
  assert.deepEqual(api.writes, [{ serverOrigin: 'http://host:8080' }]);
});

test('shipped and test builds have isolated host permissions', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'norte-ext-test-'));
  try {
    const production = await buildExtension({ output: resolve(root, 'production') });
    const fixture = await buildExtension({ output: resolve(root, 'fixture'), testOrigin: 'http://127.0.0.1:48123' });
    const manifest = async (path) => JSON.parse(await readFile(resolve(path, 'manifest.json')));
    assert.equal((await manifest(production)).host_permissions, undefined);
    assert.deepEqual((await manifest(fixture)).host_permissions, ['http://127.0.0.1:48123/*']);
    assert.equal((await manifest(production)).action.default_popup, 'popup.html');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('settings rejects invalid URLs before requesting permission and persists only healthy origins', async () => {
  for (const value of ['https://u:p@host', 'http://host/path', 'http://host/?q=x', 'http://host/#x',
    'http://host/?', 'http://host/#', 'file:///tmp', 'invalid']) {
    const api = settingsAPI();
    await assert.rejects(configureServer(value, api));
    assert.equal(api.requests.length, 0, value);
    assert.equal(api.writes.length, 0);
  }
  for (const status of [204, 301, 401, 500]) {
    const api = settingsAPI();
    await assert.rejects(configureServer('http://host:8080', api, async () => ({ status })));
    assert.equal(api.writes.length, 0);
  }
  const denied = settingsAPI(false);
  await assert.rejects(configureServer('http://host:8080', denied, () => { throw new Error('must not fetch'); }), /Permission refused/);
  assert.equal(denied.writes.length, 0);
  assert.equal(await configuredOrigin(denied), null);
  const offline = settingsAPI();
  await assert.rejects(configureServer('http://host', offline, async () => { throw new Error('offline'); }), /did not answer/);
  assert.equal(offline.writes.length, 0);
  assert.equal(serverOrigin('http://host:8080'), serverOrigin('http://host:8080/'));
  for (const value of ['http://host:8080', 'http://host:8080/']) {
    const api = settingsAPI();
    await configureServer(value, api, async () => ({ status: 200 }));
    assert.deepEqual(api.writes, [{ serverOrigin: 'http://host:8080' }]);
  }
});

test('the server origin lives in storage.local and never in storage.sync', async () => {
  const local = [], sync = [], store = {};
  const api = { permissions: { request: async () => true, contains: async () => true },
    storage: { local: { get: async () => ({ ...store }), set: async (value) => { local.push(value); Object.assign(store, value); } },
      sync: { get: async () => assert.fail('sync read'), set: async (value) => sync.push(value) } } };
  await configureServer('http://host:8080', api, async () => ({ status: 200 }));
  assert.deepEqual(local, [{ serverOrigin: 'http://host:8080' }]);
  assert.deepEqual(sync, []);
  assert.equal(await configuredOrigin(api), 'http://host:8080');
});
