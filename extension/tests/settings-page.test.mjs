import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { configureServer } from '../src/settings.js';

const settingsHTML = await readFile(new URL('../src/settings.html', import.meta.url), 'utf8');
const PERMISSION_REFUSED = "Permission refused. Authorize the server's address in order to save.";
const OFFLINE = 'The server did not answer. Check the address and try again.';
const NOT_OK = 'The server did not answer successfully. Check the address.';
let copy = 0;

// settings-page.js wires itself to the document at import and exports nothing,
// so each case gets its own document, its own stub and its own module copy.
async function withPage({ granted = true, health, healthFailure } = {}) {
  const dom = new JSDOM(settingsHTML);
  const healthCalls = [], writes = [];
  globalThis.document = dom.window.document;
  globalThis.browser = {
    permissions: { request: async () => granted },
    storage: { local: { get: async () => ({}), set: async (value) => writes.push(value) } },
  };
  globalThis.fetch = async (url) => {
    healthCalls.push(url);
    if (healthFailure) throw new Error(healthFailure);
    return health;
  };
  await import(`../src/settings-page.js?copy=${++copy}`);
  dom.window.document.getElementById('settings-form')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  async function status() {
    for (let until = Date.now() + 1000; Date.now() < until;) {
      const text = dom.window.document.getElementById('status').textContent;
      if (text) return text;
      await new Promise((done) => setTimeout(done, 5));
    }
    return dom.window.document.getElementById('status').textContent;
  }
  return { status, healthCalls, writes };
}

test('a successful probe shows Server connected. and persists the origin', async () => {
  const page = await withPage({ health: { status: 200 } });
  assert.equal(await page.status(), 'Server connected.');
  assert.deepEqual(page.writes, [{ serverOrigin: 'http://127.0.0.1:8080' }]);
  assert.deepEqual(page.healthCalls, ['http://127.0.0.1:8080/api/health']);
});

test('a refused permission shows the authorization message and fetches nothing', async () => {
  const page = await withPage({ granted: false });
  assert.equal(await page.status(), PERMISSION_REFUSED);
  assert.deepEqual(page.healthCalls, []);
  assert.deepEqual(page.writes, []);
});

test('an unreachable server shows the address-notice failure', async () => {
  const page = await withPage({ healthFailure: 'connection refused' });
  assert.equal(await page.status(), OFFLINE);
  assert.deepEqual(page.writes, []);
});

test('a probe that answers outside 200 shows the success-notice failure', async () => {
  const page = await withPage({ health: { status: 500 } });
  assert.equal(await page.status(), NOT_OK);
  assert.deepEqual(page.writes, []);
});

test('the page surfaces the same messages configureServer throws', async () => {
  const api = { permissions: { request: async () => false }, storage: { local: { get: async () => ({}), set: async () => {} } } };
  await assert.rejects(configureServer('http://host:8080', api), (error) => error.message === PERMISSION_REFUSED);
});